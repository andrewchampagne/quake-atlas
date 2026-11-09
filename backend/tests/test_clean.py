import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from quakes import clean, timeutil
from quakes.config import SOURCE_CUTOFF_MS

USGS_CSV = """time,latitude,longitude,depth,mag,magType,nst,gap,dmin,rms,net,id,updated,place,type
2011-03-11T05:46:24.120Z,38.297,142.373,29,9.1,mww,541,9.5,,1.16,us,official2011,2026-01-01T00:00:00Z,"2011 Great Tohoku Earthquake, Japan",earthquake
2011-03-11T05:54:31.940Z,37.712,141.184,32.3,6.3,mb,120,106.2,,0.75,us,usp000hvnv,2022-04-08T22:18:45Z,"30 km NNE of Namie, Japan",earthquake
2011-03-12T00:00:00.000Z,37.0,141.0,0,4.0,ml,,,,,us,blast1,2022-04-08T22:18:45Z,"Quarry",quarry blast
2011-03-13T00:00:00.000Z,37.0,141.0,10,,ml,,,,,us,nomag1,2022-04-08T22:18:45Z,"No magnitude",earthquake
"""

NOAA_ITEMS = [
    {
        "id": 7,
        "year": -464,
        "locationName": "GREECE:  SPARTA",
        "latitude": 37.1,
        "longitude": 22.4,
        "eqMagnitude": 7.2,
        "eqMagMs": 7.2,
    },
    {
        "id": 8,
        "year": 1755,
        "month": 11,
        "day": 1,
        "hour": 9,
        "minute": 40,
        "locationName": "PORTUGAL:  LISBON,ALGARVE",
        "latitude": 36.5,
        "longitude": -10.0,
        "eqDepth": 10,
        "eqMagnitude": 8.5,
        "eqMagMw": 8.4,
        "eqMagUnk": 8.5,
    },
    {
        "id": 9,
        "year": -2000,
        "locationName": "SYRIA:  UGARIT",
        "latitude": 35.7,
        "longitude": 35.8,
        "intensity": 10,
    },
]


def _usgs() -> pd.DataFrame:
    return clean.normalize_usgs(pd.read_csv(io.StringIO(USGS_CSV), dtype={"id": "string"}))


def test_normalize_usgs_parses_time_and_filters_non_earthquakes() -> None:
    df = _usgs()
    assert list(df.columns) == clean.COLUMNS
    assert "blast1" not in set(df["event_id"])
    tohoku = df[df["event_id"] == "official2011"].iloc[0]
    assert tohoku["time_ms"] == int(timeutil.epoch_ms(2011, 3, 11, 5, 46, 24.12))
    assert tohoku["depth_km"] == 29
    assert tohoku["place"] == "2011 Great Tohoku Earthquake, Japan"
    assert (df["source"] == "usgs").all()


def test_normalize_noaa_handles_bce_missing_parts_and_mag_type() -> None:
    df = clean.normalize_noaa(pd.DataFrame(NOAA_ITEMS)).set_index("event_id")
    # NOAA year -464 (464 BCE) is astronomical year -463.
    assert df.loc["noaa-7", "time_ms"] == int(timeutil.epoch_ms(-463, 1, 1))
    assert timeutil.year_of(df.loc["noaa-7", "time_ms"]) == -463
    assert df.loc["noaa-7", "mag_type"] == "Ms"
    assert df.loc["noaa-7", "place"] == "Greece: Sparta"
    assert pd.isna(df.loc["noaa-7", "depth_km"])
    assert df.loc["noaa-8", "time_ms"] == int(timeutil.epoch_ms(1755, 11, 1, 9, 40))
    # eqMagnitude 8.5 matches eqMagUnk, not eqMagMw (8.4).
    assert df.loc["noaa-8", "mag_type"] == "unknown"
    assert df.loc["noaa-8", "place"] == "Portugal: Lisbon, Algarve"
    assert pd.isna(df.loc["noaa-9", "magnitude"])


def test_noaa_year_conversion() -> None:
    years = pd.Series([-2150, -1, 1, 1899])
    assert clean.noaa_to_astronomical(years).tolist() == [-2149, 0, 1, 1899]


def test_drop_invalid_removes_nulls_and_bad_coordinates_and_wraps_longitude() -> None:
    df = pd.DataFrame(
        {
            "event_id": ["a", "b", "c", "d", None],
            "time_ms": [0, 1, 2, 3, 4],
            "latitude": [10.0, 95.0, 10.0, 10.0, 10.0],
            "longitude": [190.0, 0.0, 0.0, 0.0, 0.0],
            "depth_km": [1.0, 1.0, np.nan, 1.0, 1.0],
            "magnitude": [5.0, 5.0, 5.0, np.nan, 5.0],
            "mag_type": None,
            "place": None,
            "source": "usgs",
        }
    )
    out = clean.drop_invalid(df)
    assert out["event_id"].tolist() == ["a", "c"]  # c keeps its unknown depth
    assert out.loc[out["event_id"] == "a", "longitude"].item() == -170.0


def _row(event_id: str, t: int, lat: float, lon: float, mag: float, source: str, place: str = ""):
    return {
        "event_id": event_id,
        "time_ms": t,
        "latitude": lat,
        "longitude": lon,
        "depth_km": 10.0,
        "magnitude": mag,
        "mag_type": "mb",
        "place": place,
        "source": source,
    }


def test_deduplicate_by_id_exact_match_and_cross_source() -> None:
    df = pd.DataFrame(
        [
            _row("x", 1_000, 0, 0, 5.0, "usgs", place="old copy"),
            _row("x", 1_000, 0, 0, 5.1, "usgs", place="new copy"),
            _row("y", 5_000, 1, 1, 6.0, "usgs"),
            _row("y-dup", 5_000, 1, 1, 6.0, "usgs"),
            _row("noaa-1", 30_000 + 5_000, 1.3, 1.2, 6.1, "noaa"),  # 35 s, ~40 km from y
            _row("noaa-2", 10_000_000, 1, 1, 6.0, "noaa"),  # far in time: kept
        ]
    )
    out = clean.deduplicate(df)
    assert sorted(out["event_id"]) == ["noaa-2", "x", "y"]
    assert out.loc[out["event_id"] == "x", "place"].item() == "new copy"


def test_combine_splits_sources_at_cutoff() -> None:
    usgs = pd.DataFrame(
        [
            _row("u-old", SOURCE_CUTOFF_MS - 1, 0, 0, 5, "usgs"),
            _row("u-new", SOURCE_CUTOFF_MS, 0, 0, 5, "usgs"),
        ]
    )
    noaa = pd.DataFrame(
        [
            _row("n-old", SOURCE_CUTOFF_MS - 1, 0, 0, 5, "noaa"),
            _row("n-new", SOURCE_CUTOFF_MS, 0, 0, 5, "noaa"),
        ]
    )
    out = clean.combine(usgs, noaa)
    assert sorted(out["event_id"]) == ["n-old", "u-new"]


def test_finalize_assigns_rid_in_time_order_and_year(events_frame: pd.DataFrame) -> None:
    assert events_frame["rid"].tolist() == list(range(len(events_frame)))
    assert events_frame["time_ms"].is_monotonic_increasing
    assert events_frame["year"].iloc[0] == -463
    assert events_frame["rid"].dtype == np.uint32


def test_parquet_roundtrip_preserves_schema_and_bce_times(
    parquet_path: Path, events_frame: pd.DataFrame
) -> None:
    table = pq.read_table(parquet_path)
    assert table.schema.equals(clean.PARQUET_SCHEMA)
    times = table.column("time").cast("int64").to_pylist()
    assert times == events_frame["time_ms"].tolist()
    depths = table.column("depth_km").to_pylist()
    assert depths[0] is None  # unknown depth stays null, not NaN


def test_run_clean_end_to_end(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    (raw / "usgs" / "m5" / "2011").mkdir(parents=True)
    (raw / "usgs" / "m5" / "2011" / "chunk.csv").write_text(USGS_CSV, encoding="utf-8")
    (raw / "usgs" / "m5" / "2012").mkdir(parents=True)
    (raw / "usgs" / "m5" / "2012" / "empty.csv").write_bytes(b"")  # a 204 response
    (raw / "noaa" / "x").mkdir(parents=True)
    (raw / "noaa" / "x" / "page_0001.json").write_text(json.dumps({"items": NOAA_ITEMS}))
    out = tmp_path / "processed" / "earthquakes.parquet"

    report = clean.run_clean(raw, out)

    assert report.usgs_raw == 4 and report.noaa_raw == 3
    table = pq.read_table(out)
    # Tohoku + aftershock + Sparta + Lisbon; blast, missing-magnitude rows dropped.
    assert table.num_rows == 4
    assert table.column("source").to_pylist() == ["noaa", "noaa", "usgs", "usgs"]
    assert table.column("year").to_pylist() == [-463, 1755, 2011, 2011]
