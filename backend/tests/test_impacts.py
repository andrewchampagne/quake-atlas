"""Impact matching must preserve missing values and avoid unrelated events."""

import pandas as pd

from quakes.clean import clean_frames
from quakes.query import Filters, deaths_label


def test_death_reports_match_time_and_location_and_preserve_unknown():
    usgs = pd.DataFrame(
        [
            {
                "id": "haiti",
                "time": "2010-01-12T21:53:10Z",
                "latitude": 18.4,
                "longitude": -72.5,
                "mag": 7.0,
                "depth": 13,
            },
            {
                "id": "other",
                "time": "2010-01-12T21:53:10Z",
                "latitude": 40,
                "longitude": 140,
                "mag": 7.0,
                "depth": 13,
            },
            {
                "id": "zero",
                "time": "2011-01-12T21:53:10Z",
                "latitude": 18.4,
                "longitude": -72.5,
                "mag": 6.0,
                "depth": 13,
            },
        ]
    )
    noaa = pd.DataFrame(
        [
            {
                "id": 1,
                "year": 2010,
                "month": 1,
                "day": 12,
                "hour": 21,
                "minute": 53,
                "latitude": 18.45,
                "longitude": -72.5,
                "eqMagnitude": 7,
                "deaths": 100,
                "deathsTotal": 120,
            },
            {
                "id": 2,
                "year": 2011,
                "month": 1,
                "day": 12,
                "hour": 21,
                "minute": 53,
                "latitude": 18.45,
                "longitude": -72.5,
                "eqMagnitude": 6,
                "deaths": 0,
            },
        ]
    )
    result = clean_frames(usgs, noaa).set_index("event_id")
    assert result.loc["haiti", "deaths"] == 120
    assert pd.isna(result.loc["other", "deaths"])
    assert result.loc["zero", "deaths"] == 0
    assert len(result) == 3  # NOAA enriches, never duplicates, modern events.


def test_unknown_label_does_not_claim_zero():
    assert "Unknown" in deaths_label(None, None)
    assert deaths_label(0, 0) == "None recorded"
    assert "approximate" in deaths_label(None, 3)


def test_death_summary_separates_counts_and_ranges(store):
    summary = store.summary(Filters())
    assert summary.total_deaths == 326331
    assert summary.deadly_events == 6
    assert summary.approx_deadly_events == 1
    assert summary.deadliest.event_id == "us3"
    assert store.count(Filters(deadly_only=True)) == 6
