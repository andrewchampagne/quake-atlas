"""Nearest-neighbour clustering, family assignment, the store integration and the API."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

from quakes.api import create_app
from quakes.clean import finalize, to_arrow, write_parquet
from quakes.config import Settings
from quakes.families import (
    EARTH_RADIUS_KM,
    ROLES,
    assign_families,
    build_families,
    fit_threshold,
    nearest_neighbours,
    read_info,
    trim_members,
)
from quakes.query import Filters, QuakeStore
from tests.conftest import ms

DAY_MS = 86_400_000


def brute_force(t, lat, lon, m, *, b=1.0, df=1.6, r_min=1.0, t_min=1 / (365.25 * 86400)):
    """Reference nearest neighbours by checking every earlier event."""
    lat, lon = np.radians(lat), np.radians(lon)
    n = len(t)
    parent = np.full(n, -1)
    best = np.full(n, np.inf)
    for j in range(1, n):
        i = np.arange(j)
        dt = np.maximum(t[j] - t[i], t_min)
        a = (
            np.sin((lat[j] - lat[i]) / 2) ** 2
            + np.cos(lat[j]) * np.cos(lat[i]) * np.sin((lon[j] - lon[i]) / 2) ** 2
        )
        r = np.maximum(2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.minimum(a, 1))), r_min)
        le = np.log10(dt) + df * np.log10(r) - b * m[i]
        k = int(np.argmin(le))
        parent[j], best[j] = k, le[k]
    return parent, best


def clustered_catalog(seed: int = 0, n_background: int = 400) -> tuple[np.ndarray, ...]:
    """Background events on two plate-boundary-like bands plus three aftershock sequences."""
    rng = np.random.default_rng(seed)
    t = rng.uniform(0, 20, n_background)
    lat = np.where(
        rng.random(n_background) < 0.5,
        rng.normal(35, 3, n_background),
        rng.normal(-5, 4, n_background),
    )
    lon = rng.uniform(-180, 180, n_background)
    m = 5 + rng.exponential(0.43, n_background)
    for t0, la, lo, mm in (
        (4.0, 36.0, 140.0, 7.8),
        (11.0, -4.0, 100.0, 7.2),
        (17.0, 34.0, -118.0, 6.9),
    ):
        k = 60
        dt = rng.exponential(0.05, k) ** 1.5
        t = np.r_[t, t0, t0 + dt]
        lat = np.r_[lat, la, la + rng.normal(0, 0.3, k)]
        lon = np.r_[lon, lo, lo + rng.normal(0, 0.3, k)]
        m = np.r_[m, mm, 5 + rng.exponential(0.43, k)]
    order = np.argsort(t, kind="stable")
    return t[order], lat[order], lon[order], m[order]


# --------------------------------------------------------------------------- algorithm


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_pruned_search_matches_brute_force(seed: int) -> None:
    t, lat, lon, m = clustered_catalog(seed)
    nn = nearest_neighbours(t, lat, lon, m, log_cap=-1.5)
    parent, best = brute_force(t, lat, lon, m)
    exact = ~np.isnan(nn.log_eta)
    assert exact.sum() > 100
    np.testing.assert_array_equal(nn.parent[exact], parent[exact])
    np.testing.assert_allclose(nn.log_eta[exact], best[exact], atol=1e-9)
    # Events reported as having no neighbour under the cap truly have none.
    assert np.all(best[~exact] >= -1.5)
    # The rescaled components multiply back to eta.
    np.testing.assert_allclose(nn.log_t[exact] + nn.log_r[exact], nn.log_eta[exact], atol=1e-9)


def test_search_with_a_high_cap_is_exact_everywhere() -> None:
    t, lat, lon, m = clustered_catalog(3, n_background=150)
    nn = nearest_neighbours(t, lat, lon, m, log_cap=6.0)
    parent, _ = brute_force(t, lat, lon, m)
    np.testing.assert_array_equal(nn.parent[1:], parent[1:])
    assert nn.parent[0] == -1 and np.isnan(nn.log_eta[0])


def test_search_requires_time_order() -> None:
    with pytest.raises(ValueError, match="sorted"):
        nearest_neighbours([1.0, 0.5], [0, 0], [0, 0], [5, 5])


def test_simultaneous_and_colocated_events_use_the_floors() -> None:
    nn = nearest_neighbours([1.0, 1.0], [10.0, 10.0], [20.0, 20.0], [6.0, 5.0], log_cap=10)
    assert nn.parent.tolist() == [-1, 0]
    # dt floored to 1 s, r floored to 1 km: log10(1 s in years) + 0 - 6.
    assert nn.log_eta[1] == pytest.approx(np.log10(1 / (365.25 * 86400)) - 6.0)


def test_threshold_between_two_modes() -> None:
    rng = np.random.default_rng(0)
    x = np.r_[rng.normal(-8, 1.0, 3000), rng.normal(-4, 0.6, 7000)]
    fit = fit_threshold(x)
    assert fit.method == "gaussian-mixture"
    assert -6.5 < fit.log_eta < -5.0
    assert fit.means[0] == pytest.approx(-8, abs=0.2)


def test_threshold_falls_back_without_two_modes() -> None:
    rng = np.random.default_rng(0)
    assert fit_threshold(rng.normal(-4, 0.5, 5000)).method == "default"
    assert fit_threshold([-8.0, -4.0]).log_eta == -5.0


def test_censored_values_count_as_background() -> None:
    rng = np.random.default_rng(1)
    x = np.r_[rng.normal(-8, 0.8, 500), np.full(2000, np.nan)]
    fit = fit_threshold(x, censored_value=-1.5)
    assert fit.method == "gaussian-mixture"
    assert -8 < fit.log_eta < -1.5


def test_assign_families_roles_generations_and_mainshocks() -> None:
    # 0: single.  1 -> 2 -> 3, 2 -> 4: one family whose largest event is 2.
    # 5 and 6 tie at M6: the earlier one (5) is the mainshock.
    nn_parent = [-1, -1, 1, 2, 2, -1, 5, 0]
    log_eta = [np.nan, np.nan, -8, -9, -7, np.nan, -8, -2]  # 7's link is too weak
    mag = [5.0, 6.0, 7.0, 5.5, 5.2, 6.0, 6.0, 5.1]
    a = assign_families(nn_parent, log_eta, mag, threshold=-5.0)
    assert a.parent.tolist() == [-1, -1, 1, 2, 2, -1, 5, -1]
    assert a.root.tolist() == [0, 1, 1, 1, 1, 5, 5, 7]
    assert a.generation.tolist() == [0, 0, 1, 2, 2, 0, 1, 0]
    assert a.size.tolist() == [1, 4, 4, 4, 4, 2, 2, 1]
    assert a.mainshock.tolist() == [0, 2, 2, 2, 2, 5, 5, 7]
    names = {v: k for k, v in ROLES.items()}
    assert [names[r] for r in a.role] == [
        "single",
        "foreshock",
        "mainshock",
        "aftershock",
        "aftershock",
        "mainshock",
        "aftershock",
        "single",
    ]


def test_trim_members_keeps_ancestors_and_reconnects_the_tree() -> None:
    rid = np.array([10, 11, 12, 13, 14])
    parent = np.array([-1, 10, 11, 12, 10])
    mag = np.array([7.0, 4.0, 4.1, 4.2, 6.0])
    keep, display = trim_members(rid, parent, mag, {13}, limit=3)
    # 13 needs 12, 11 and 10; that already exceeds the limit, so nothing else is added.
    assert keep.tolist() == [True, True, True, True, False]
    keep, display = trim_members(rid, parent, mag, {10}, limit=3)
    assert keep.tolist() == [True, False, False, True, True]
    assert display[3] == 10  # 13's parent 12 was dropped; it hangs off the root instead
    keep, display = trim_members(rid, parent, mag, {10}, limit=10)
    assert keep.all() and display.tolist() == parent.tolist()


# --------------------------------------------------------------------------- store + API


def catalog_frame() -> pd.DataFrame:
    """Background events, a foreshock-mainshock-aftershock sequence and NOAA records."""
    rng = np.random.default_rng(7)
    rows = []
    for k in range(240):
        rows.append(
            (
                f"bg{k}",
                ms(2001) + int(rng.uniform(0, 20 * 365) * DAY_MS),
                float(rng.uniform(-60, 60)),
                float(rng.uniform(-180, 180)),
                10.0,
                float(5 + rng.exponential(0.43)),
                "mb",
                f"Background {k}",
                "usgs",
            )
        )
    main = ms(2010, 1, 1)
    rows.append(("fore", main - DAY_MS, 10.05, 120.0, 10.0, 6.1, "mww", "Foreshock", "usgs"))
    rows.append(("main", main, 10.0, 120.0, 15.0, 7.6, "mww", "Mainshock", "usgs"))
    # Omori-like aftershock times (days) within ~30 km.
    days = np.sort(0.05 * ((1 - rng.random(80)) ** (-1 / 0.1) - 1))[:60]
    days = days[days < 300]
    for k, d in enumerate(days):
        rows.append(
            (
                f"after{k}",
                main + int(max(d, 0.001) * DAY_MS),
                10.0 + float(rng.normal(0, 0.15)),
                120.0 + float(rng.normal(0, 0.15)),
                12.0,
                float(5 + rng.exponential(0.3)),
                "mb",
                f"Aftershock {k}",
                "usgs",
            )
        )
    rows.append(("noaa-1", ms(1755, 11, 1), 36.5, -10.0, None, 8.5, None, "Lisbon", "noaa"))
    rows.append(("noaa-2", ms(1906, 4, 18), 37.7, -122.5, None, 7.9, None, "SF", "noaa"))
    df = pd.DataFrame(
        rows,
        columns=[
            "event_id",
            "time_ms",
            "latitude",
            "longitude",
            "depth_km",
            "magnitude",
            "mag_type",
            "place",
            "source",
        ],
    )
    df["depth_km"] = df["depth_km"].astype("float64")
    df["deaths"] = pd.array([None] * len(df), dtype="Int64")
    df["deaths_order"] = pd.array([None] * len(df), dtype="Int64")
    return finalize(df)


@pytest.fixture
def family_paths(tmp_path: Path) -> tuple[Path, Path]:
    catalog = tmp_path / "processed" / "earthquakes.parquet"
    write_parquet(to_arrow(catalog_frame()), catalog)
    families = catalog.with_name("families.parquet")
    build_families(catalog, families)
    return catalog, families


@pytest.fixture
def family_store(family_paths: tuple[Path, Path]) -> Iterator[QuakeStore]:
    store = QuakeStore(family_paths[0])
    yield store
    store.close()


def rid_of(store: QuakeStore, event_id: str) -> int:
    row = (
        store._cursor().execute("SELECT rid FROM quakes WHERE event_id = ?", [event_id]).fetchone()
    )
    assert row is not None
    return int(row[0])


def test_build_writes_metadata(family_paths: tuple[Path, Path]) -> None:
    info = read_info(family_paths[1])
    assert info is not None
    assert info.analysed == 240 + 2 + len(
        [c for c in catalog_frame()["event_id"] if c.startswith("after")]
    )
    assert info.threshold_method == "gaussian-mixture"
    assert info.b_value == 1.0 and info.fractal_dimension == 1.6


def test_sequence_roles(family_store: QuakeStore) -> None:
    family = family_store.family(rid_of(family_store, "main"))
    assert family is not None
    assert family.role == "mainshock"
    assert family.mainshock is not None and family.mainshock.place == "Mainshock"
    assert family.foreshocks == 1
    assert family.aftershocks >= 40
    assert family.root_rid == rid_of(family_store, "fore")
    assert family.forecast_eligible
    members = family.members
    assert len(members.rid) == family.size
    assert members.time == sorted(members.time)
    assert members.parent_rid[0] is None  # the root
    assert all(p is not None for p in members.parent_rid[1:])
    assert sum(g.count for g in family.generations) == family.size

    after = family_store.family(rid_of(family_store, "after3"))
    assert after is not None and after.role == "aftershock"
    assert after.cluster_id == family.cluster_id
    assert after.neighbour is not None and after.neighbour.linked
    assert after.neighbour.log_eta is not None
    assert after.neighbour.log_eta < after.neighbour.threshold


def test_noaa_events_are_unclassified(family_store: QuakeStore) -> None:
    family = family_store.family(rid_of(family_store, "noaa-1"))
    assert family is not None
    assert family.role == "unclassified"
    assert family.size == 1 and family.members.rid == [family.rid]
    assert family.mainshock is None and not family.forecast_eligible
    assert family_store.family(999_999) is None


def test_declustered_filter_keeps_mainshocks_and_noaa(family_store: QuakeStore) -> None:
    total = family_store.count(Filters())
    declustered = family_store.count(Filters(declustered=True))
    stats = family_store.family_stats()
    dependent = stats.roles["foreshock"] + stats.roles["aftershock"]
    assert declustered == total - dependent
    assert family_store.count(Filters(declustered=True, sources=("noaa",))) == 2
    summary = family_store.summary(Filters(declustered=True))
    assert summary.total == declustered
    assert summary.strongest is not None and summary.strongest.event_id == "noaa-1"


def test_events_payload_carries_roles(family_store: QuakeStore) -> None:
    table = family_store.events(Filters()).table
    roles = dict(
        zip(table.column("rid").to_pylist(), table.column("role").to_pylist(), strict=True)
    )
    assert roles[rid_of(family_store, "main")] == ROLES["mainshock"]
    assert roles[rid_of(family_store, "fore")] == ROLES["foreshock"]
    assert roles[rid_of(family_store, "noaa-1")] == ROLES["unclassified"]
    assert table.schema.field("role").type == pa.uint8()


def test_family_stats(family_store: QuakeStore) -> None:
    stats = family_store.family_stats()
    assert stats.analysed == sum(stats.roles.values())
    assert stats.largest[0].mainshock.place == "Mainshock"
    assert stats.largest[0].size == stats.largest[0].foreshocks + stats.largest[0].aftershocks + 1
    assert len(stats.density.counts) == len(stats.density.x_edges) - 1
    assert len(stats.density.counts[0]) == len(stats.density.y_edges) - 1
    assert sum(stats.eta_histogram.counts) > 0
    assert 0 < stats.clustered_fraction < 1


def test_forecast_for_the_sequence(family_store: QuakeStore) -> None:
    result = family_store.aftershock_forecast(
        rid_of(family_store, "after0"), fit_days=3, horizon_days=200
    )
    assert result is not None
    assert result.mainshock.place == "Mainshock"
    assert result.status == "ok", result.message
    assert result.params is not None and result.n_fit >= 3
    assert result.interval_after_fit is not None
    lo, hi = result.interval_after_fit
    assert lo <= result.expected_after_fit <= hi  # type: ignore[operator]
    at_fit = next(p for p in result.model if p.days == 3)
    assert at_fit.expected == pytest.approx(result.n_fit)
    assert all(p.lower is not None for p in result.model if p.days > 3)
    counts = [p.count for p in result.observed]
    assert counts == sorted(counts)


def test_forecast_not_offered_for_small_or_historical_events(family_store: QuakeStore) -> None:
    small = family_store.aftershock_forecast(
        rid_of(family_store, "bg0"), fit_days=3, horizon_days=30
    )
    assert small is not None and small.status == "not-eligible"
    noaa = family_store.aftershock_forecast(
        rid_of(family_store, "noaa-1"), fit_days=3, horizon_days=30
    )
    assert noaa is not None and noaa.status == "not-eligible"


def test_stale_families_are_ignored(family_paths: tuple[Path, Path], tmp_path: Path) -> None:
    catalog, families = family_paths
    df = catalog_frame()
    df = df[df["event_id"] != "bg0"]  # shifts every later rid
    write_parquet(to_arrow(finalize(df.drop(columns=["rid", "year"], errors="ignore"))), catalog)
    store = QuakeStore(catalog, families_path=families)
    try:
        assert store.families_info is None
        assert store.count(Filters(declustered=True)) == store.count(Filters())
        assert set(store.events(Filters()).table.column("role").to_pylist()) == {0}
    finally:
        store.close()


def test_store_without_families(store: QuakeStore) -> None:
    assert store.families_info is None
    assert store.meta(100).families_ready is False
    with pytest.raises(RuntimeError):
        store.family(0)


@pytest.fixture
def family_client(tmp_path: Path, family_store: QuakeStore) -> TestClient:
    settings = Settings(data_dir=tmp_path / "unused", max_points=1000, frontend_dist=tmp_path / "x")
    return TestClient(create_app(settings, family_store))


def test_api_family_endpoints(family_client: TestClient, family_store: QuakeStore) -> None:
    assert family_client.get("/api/meta").json()["families_ready"] is True
    stats = family_client.get("/api/families/stats").json()
    assert stats["threshold"] < stats["log_eta_cap"] - 1 and stats["largest"]
    main = rid_of(family_store, "main")
    body = family_client.get(f"/api/families/{main}").json()
    assert body["role"] == "mainshock" and body["size"] == len(body["members"]["rid"])
    assert family_client.get("/api/families/999999").status_code == 404
    fc = family_client.get(f"/api/families/{main}/forecast", params={"fit_days": 7}).json()
    assert fc["status"] == "ok" and fc["fit_days"] == 7
    bad = family_client.get(f"/api/families/{main}/forecast?fit_days=30&horizon_days=10")
    assert bad.status_code == 422
    assert family_client.get(f"/api/families/{main}/forecast?fit_days=0").status_code == 422


def test_api_declustered_parameter(family_client: TestClient) -> None:
    everything = family_client.get("/api/summary").json()["total"]
    declustered = family_client.get("/api/summary?declustered=true").json()["total"]
    assert declustered < everything
    resp = family_client.get("/api/events?declustered=true")
    assert resp.headers["x-total-count"] == str(declustered)


def test_api_family_endpoints_need_a_build(client: TestClient) -> None:
    assert client.get("/api/meta").json()["families_ready"] is False
    resp = client.get("/api/families/stats")
    assert resp.status_code == 503 and "build-families" in resp.json()["detail"]
    assert client.get("/api/families/1").status_code == 503
