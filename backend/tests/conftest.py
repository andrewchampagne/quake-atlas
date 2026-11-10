"""Shared fixtures: a tiny, hand-checkable catalog written through the real cleaning code."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from quakes import timeutil
from quakes.api import create_app
from quakes.clean import finalize, to_arrow, write_parquet
from quakes.config import Settings
from quakes.query import QuakeStore


def ms(year: int, month: int = 1, day: int = 1, hour: int = 0, minute: int = 0) -> int:
    return int(timeutil.epoch_ms(year, month, day, hour, minute))


#: (event_id, time_ms, lat, lon, depth_km, magnitude, mag_type, place, source)
EVENTS = [
    ("noaa-1", ms(-463), 37.1, 22.4, None, 7.2, "Ms", "Greece: Sparta", "noaa"),
    (
        "noaa-2",
        ms(1755, 11, 1, 9, 40),
        36.5,
        -10.0,
        None,
        8.5,
        "unknown",
        "Portugal: Lisbon",
        "noaa",
    ),
    ("us1", ms(2000, 6, 1), 10.0, 100.0, 10.0, 5.0, "mb", "Somewhere A", "usgs"),
    ("us2", ms(2000, 7, 1), -20.0, -70.0, 300.0, 6.0, "mww", "Somewhere B", "usgs"),
    ("us3", ms(2004, 12, 26, 0, 58), 3.3, 95.9, 30.0, 9.1, "mw", "Off Sumatra", "usgs"),
    ("us4", ms(2011, 3, 11, 5, 46), 38.3, 142.4, 29.0, 9.1, "mww", "Near Tohoku", "usgs"),
    ("us5", ms(2011, 3, 11, 6, 0), 38.0, 142.0, 650.0, 5.5, "mb", "Deep one", "usgs"),
    ("us6", ms(2020, 1, 1), 0.0, 0.0, 5.0, 5.2, "mb", "Null Island", "usgs"),
    ("us7", ms(2020, 6, 1), 1.0, 1.0, None, 5.1, None, None, "usgs"),
]


#: event_id -> (deaths, deaths_order). us6 has only an approximate NOAA order (101-1000).
DEATHS: dict[str, tuple[int | None, int | None]] = {
    "noaa-1": (20_000, 4),
    "noaa-2": (60_000, 4),
    "us1": (None, None),
    "us2": (5, 1),
    "us3": (227_898, 4),
    "us4": (18_428, 4),
    "us5": (None, None),
    "us6": (None, 3),
    "us7": (None, None),
}


@pytest.fixture
def events_frame() -> pd.DataFrame:
    df = pd.DataFrame(
        EVENTS,
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
    df["deaths"] = pd.array([DEATHS[e][0] for e in df["event_id"]], dtype="Int64")
    df["deaths_order"] = pd.array([DEATHS[e][1] for e in df["event_id"]], dtype="Int64")
    return finalize(df)


@pytest.fixture
def parquet_path(tmp_path: Path, events_frame: pd.DataFrame) -> Path:
    path = tmp_path / "processed" / "earthquakes.parquet"
    write_parquet(to_arrow(events_frame), path)
    return path


@pytest.fixture
def store(parquet_path: Path) -> Iterator[QuakeStore]:
    s = QuakeStore(parquet_path)
    yield s
    s.close()


@pytest.fixture
def make_client(tmp_path: Path, store: QuakeStore) -> Callable[..., TestClient]:
    """Factory for API test clients with configurable limits and data."""

    def factory(
        *, max_points: int = 1000, frontend_dist: Path | None = None, with_store: bool = True
    ) -> TestClient:
        settings = Settings(
            data_dir=tmp_path / "empty-data",
            max_points=max_points,
            frontend_dist=frontend_dist or tmp_path / "no-dist",
        )
        return TestClient(create_app(settings, store if with_store else None))

    return factory


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()
