import math

import pytest

from quakes.query import EVENT_COLUMNS, Filters, QuakeStore, event_url
from tests.conftest import ms


def ids(store: QuakeStore, filters: Filters) -> set[str]:
    rids = store.events(filters).table.column("rid").to_pylist()
    return {store.event(r).event_id for r in rids}  # type: ignore[union-attr]


def test_unfiltered_returns_everything(store: QuakeStore) -> None:
    result = store.events(Filters())
    assert result.total == 9 and result.returned == 9
    assert not result.downsampled and result.min_mag_returned is None
    assert tuple(result.table.column_names) == EVENT_COLUMNS
    assert str(result.table.schema.field("rid").type) == "uint32"
    assert str(result.table.schema.field("time").type) == "double"
    assert str(result.table.schema.field("lon").type) == "float"
    assert str(result.table.schema.field("source").type) == "uint8"


def test_events_sorted_by_descending_magnitude(store: QuakeStore) -> None:
    mags = store.events(Filters()).table.column("magnitude").to_pylist()
    assert mags == sorted(mags, reverse=True)


def test_time_filter_is_half_open_and_handles_bce(store: QuakeStore) -> None:
    assert ids(store, Filters(end=ms(1900))) == {"noaa-1", "noaa-2"}
    assert ids(store, Filters(start=ms(-1000), end=ms(0))) == {"noaa-1"}
    assert ids(store, Filters(start=ms(2011, 3, 11, 5, 46), end=ms(2011, 3, 11, 6, 0))) == {"us4"}


def test_magnitude_filter_is_inclusive(store: QuakeStore) -> None:
    # 9.1 and 5.1 are not exact in float32: bounds must compare at the column's precision.
    assert ids(store, Filters(min_mag=9.1)) == {"us3", "us4"}
    assert ids(store, Filters(max_mag=5.1)) == {"us1", "us7"}
    assert ids(store, Filters(min_mag=5.1, max_mag=5.1)) == {"us7"}


def test_depth_filter_excludes_unknown_depth(store: QuakeStore) -> None:
    assert ids(store, Filters(min_depth=100)) == {"us2", "us5"}
    shallow = ids(store, Filters(max_depth=30))
    assert shallow == {"us1", "us3", "us4", "us6"}
    assert "us7" not in shallow and "noaa-1" not in shallow


def test_unknown_depth_encoded_as_nan(store: QuakeStore) -> None:
    table = store.events(Filters(sources=("noaa",))).table
    assert all(math.isnan(d) for d in table.column("depth_km").to_pylist())
    assert set(table.column("source").to_pylist()) == {1}


def test_source_filter(store: QuakeStore) -> None:
    assert store.count(Filters(sources=("usgs",))) == 7
    assert store.count(Filters(sources=("noaa", "usgs"))) == 9
    assert store.count(Filters(sources=())) == 0


def test_downsampling_keeps_strongest(store: QuakeStore) -> None:
    result = store.events(Filters(), max_points=3)
    assert result.downsampled and result.total == 9 and result.returned == 3
    assert result.table.column("magnitude").to_pylist() == pytest.approx([9.1, 9.1, 8.5])
    assert result.min_mag_returned == pytest.approx(8.5)


def test_no_downsampling_at_exact_limit(store: QuakeStore) -> None:
    assert not store.events(Filters(), max_points=9).downsampled


def test_summary_per_year_and_strongest(store: QuakeStore) -> None:
    summary = store.summary(Filters())
    assert summary.total == 9
    per_year = {y.year: y.count for y in summary.per_year}
    assert per_year == {-463: 1, 1755: 1, 2000: 2, 2004: 1, 2011: 2, 2020: 2}
    # Sumatra (2004) and Tohoku (2011) tie at 9.1: the earlier event wins.
    assert summary.strongest is not None and summary.strongest.event_id == "us3"


def test_summary_respects_filters_and_is_cached(store: QuakeStore) -> None:
    f = Filters(start=ms(2010), sources=("usgs",))
    first = store.summary(f)
    assert first.total == 4
    assert first.strongest is not None and first.strongest.event_id == "us4"
    assert store.summary(Filters(start=ms(2010), sources=("usgs",))) is first


def test_summary_empty_result(store: QuakeStore) -> None:
    summary = store.summary(Filters(min_mag=9.5))
    assert summary.total == 0 and summary.strongest is None and summary.per_year == []


def test_event_detail(store: QuakeStore) -> None:
    lisbon = store.event(1)
    assert lisbon is not None
    assert lisbon.event_id == "noaa-2" and lisbon.depth_km is None
    assert lisbon.time_label == "1 Nov 1755"  # NOAA: date only
    tohoku = store.event(5)
    assert tohoku is not None and tohoku.event_id == "us4"
    assert tohoku.time_label == "11 Mar 2011, 05:46:00 UTC"
    assert tohoku.url == "https://earthquake.usgs.gov/earthquakes/eventpage/us4"
    assert store.event(999) is None


def test_meta(store: QuakeStore) -> None:
    meta = store.meta(max_points=123)
    assert meta.total == 9 and meta.max_points == 123
    assert meta.min_year == -463 and meta.max_year == 2020
    assert meta.min_time == ms(-463)
    assert meta.magnitude.min == 5.0 and meta.magnitude.max == 9.1  # float32 noise rounded
    assert meta.depth.min == 5.0 and meta.depth.max == 650.0
    assert [(s.id, s.code, s.count) for s in meta.sources] == [("usgs", 0, 7), ("noaa", 1, 2)]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"start": 10, "end": 5},
        {"min_mag": 7, "max_mag": 6},
        {"min_depth": 50, "max_depth": 10},
        {"sources": ("usgs", "isc")},
        {"min_mag": float("nan")},
    ],
)
def test_invalid_filters_raise(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        Filters(**kwargs)  # type: ignore[arg-type]


def test_filters_normalise_sources() -> None:
    assert Filters(sources=("usgs", "noaa", "usgs")) == Filters(sources=("noaa", "usgs"))
    assert hash(Filters(sources=("usgs", "noaa"))) == hash(Filters(sources=("noaa", "usgs")))


def test_event_url() -> None:
    assert event_url(
        "noaa-12",
        "noaa",
    ).endswith("/event-more-info/12")
    assert event_url("weird", "other") is None


def test_strongest_prefers_instrumental_on_ties(tmp_path, events_frame) -> None:  # type: ignore[no-untyped-def]
    from quakes.clean import to_arrow, write_parquet

    df = events_frame.copy()
    df.loc[df["event_id"] == "noaa-2", "magnitude"] = 9.1  # 1755 estimate ties the 9.1s
    path = tmp_path / "tie.parquet"
    write_parquet(to_arrow(df), path)
    tie_store = QuakeStore(path)
    try:
        strongest = tie_store.summary(Filters()).strongest
        assert strongest is not None and strongest.event_id == "us3"
    finally:
        tie_store.close()
