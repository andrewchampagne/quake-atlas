"""Geocoder tests: Photon is mocked; the local fallback uses a tiny places table."""

from __future__ import annotations

from pathlib import Path

import httpx
import pandas as pd

from quakes.geocode import Geocoder, parse_photon

PHOTON = {
    "features": [
        {
            "properties": {
                "name": "Kathmandu",
                "state": "Bagmati",
                "country": "Nepal",
                "type": "city",
            },
            "geometry": {"coordinates": [85.32, 27.71]},
        },
        {  # duplicate label: dropped
            "properties": {"name": "Kathmandu", "state": "Bagmati", "country": "Nepal"},
            "geometry": {"coordinates": [85.29, 27.69]},
        },
        {"properties": {"name": "No geometry"}, "geometry": {}},
    ]
}


def _places(tmp_path: Path) -> Path:
    path = tmp_path / "places.parquet"
    pd.DataFrame(
        {
            "name": ["Lima", "Limassol", "Palimar", "Tokyo"],
            "country": ["Peru", "Cyprus", "India", "Japan"],
            "latitude": [-12.0, 34.7, 13.0, 35.7],
            "longitude": [-77.0, 33.0, 75.0, 139.7],
            "population": [9e6, 2e5, 1e4, 3.5e7],
        }
    ).to_parquet(path)
    return path


def _client(handler) -> httpx.Client:  # type: ignore[no-untyped-def]
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_parse_photon_labels_and_dedupes() -> None:
    results = parse_photon(PHOTON)
    assert [r.label for r in results] == ["Kathmandu, Bagmati, Nepal"]
    assert results[0].latitude == 27.71 and results[0].longitude == 85.32
    assert results[0].kind == "city" and results[0].source == "photon"


def test_search_uses_photon_and_caches(tmp_path: Path) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.params["q"])
        return httpx.Response(200, json=PHOTON)

    geo = Geocoder(_places(tmp_path), client=_client(handler))
    assert geo.search("kathm")[0].name == "Kathmandu"
    geo.search("Kathm ")
    assert calls == ["kathm"]  # second query hit the cache


def test_falls_back_to_local_cities_when_photon_fails(tmp_path: Path) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    geo = Geocoder(_places(tmp_path), client=_client(down))
    results = geo.search("lim")
    # Prefix matches first (most populous first), then substring matches.
    assert [r.name for r in results] == ["Lima", "Limassol", "Palimar"]
    assert results[0].label == "Lima, Peru" and results[0].source == "local"


def test_no_places_and_no_photon_returns_empty(tmp_path: Path) -> None:
    geo = Geocoder(None, client=_client(lambda r: httpx.Response(503)))
    assert geo.search("anything") == []
