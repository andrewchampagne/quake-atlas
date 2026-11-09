from collections.abc import Callable
from pathlib import Path

import pyarrow as pa
from fastapi.testclient import TestClient

from quakes.query import EVENT_COLUMNS
from tests.conftest import ms

ARROW = "application/vnd.apache.arrow.stream"


def decode(resp) -> pa.Table:  # type: ignore[no-untyped-def]
    return pa.ipc.open_stream(resp.content).read_all()


def test_events_returns_arrow_stream(client: TestClient) -> None:
    resp = client.get("/api/events")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == ARROW
    assert resp.headers["content-encoding"] == "gzip"  # httpx sends Accept-Encoding: gzip
    table = decode(resp)
    assert tuple(table.column_names) == EVENT_COLUMNS
    assert table.num_rows == 9
    assert resp.headers["x-total-count"] == "9"
    assert resp.headers["x-returned-count"] == "9"
    assert resp.headers["x-downsampled"] == "0"


def test_events_without_gzip(client: TestClient) -> None:
    resp = client.get("/api/events", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in resp.headers
    assert decode(resp).num_rows == 9


def test_events_filters(client: TestClient) -> None:
    params = {"start": ms(2000), "end": ms(2012), "min_mag": 5.5, "sources": "usgs"}
    table = decode(client.get("/api/events", params=params))
    assert sorted(table.column("rid").to_pylist()) == [3, 4, 5, 6]


def test_sources_repeatable_and_comma_separated(client: TestClient) -> None:
    a = client.get("/api/events?sources=usgs&sources=noaa")
    b = client.get("/api/events?sources=noaa,usgs")
    assert a.headers["x-total-count"] == b.headers["x-total-count"] == "9"
    assert client.get("/api/events?sources=noaa").headers["x-total-count"] == "2"


def test_events_downsampling_headers(make_client: Callable[..., TestClient]) -> None:
    resp = make_client(max_points=4).get("/api/events")
    assert resp.headers["x-downsampled"] == "1"
    assert resp.headers["x-total-count"] == "9"
    assert resp.headers["x-returned-count"] == "4"
    assert resp.headers["x-min-mag-returned"] == "7.20"
    assert decode(resp).num_rows == 4


def test_events_payload_is_cached(client: TestClient) -> None:
    state = client.app.state.quakes  # type: ignore[attr-defined]
    client.get("/api/events?min_mag=6")
    client.get("/api/events?min_mag=6.0")
    assert state.payload_cache.hits == 1 and len(state.payload_cache) == 1


def test_invalid_filters_return_422(client: TestClient) -> None:
    assert client.get("/api/events?min_mag=7&max_mag=6").status_code == 422
    assert client.get("/api/events?sources=isc").status_code == 422
    assert client.get("/api/summary?start=abc").status_code == 422


def test_event_detail(client: TestClient) -> None:
    body = client.get("/api/events/5").json()
    assert body["event_id"] == "us4"
    assert body["magnitude"] == 9.1
    assert body["mag_type"] == "mww"
    assert body["source"] == "usgs"
    assert body["time_label"].startswith("11 Mar 2011")
    assert client.get("/api/events/0").json()["time_label"] == "1 Jan 464 BCE"
    assert client.get("/api/events/12345").status_code == 404


def test_summary(client: TestClient) -> None:
    body = client.get("/api/summary", params={"min_mag": 6}).json()
    assert body["total"] == 5
    assert body["strongest"]["event_id"] == "us3"
    assert body["per_year"][0] == {"year": -463, "count": 1}


def test_meta(client: TestClient) -> None:
    body = client.get("/api/meta").json()
    assert body["total"] == 9 and body["max_points"] == 1000
    assert body["min_year"] == -463
    assert {s["id"] for s in body["sources"]} == {"usgs", "noaa"}


def test_cors_exposes_custom_headers(client: TestClient) -> None:
    resp = client.get("/api/events", headers={"Origin": "http://localhost:5173"})
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "X-Downsampled" in resp.headers["access-control-expose-headers"]


def test_json_responses_are_gzipped(client: TestClient) -> None:
    resp = client.get("/api/summary")
    assert resp.headers.get("content-encoding") == "gzip" or len(resp.content) < 1024


def test_missing_dataset_returns_503(make_client: Callable[..., TestClient]) -> None:
    resp = make_client(with_store=False).get("/api/meta")
    assert resp.status_code == 503
    assert "make sample" in resp.json()["detail"]


def test_serves_built_frontend(make_client: Callable[..., TestClient], tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>quakes</html>")
    client = make_client(frontend_dist=dist)
    assert "quakes" in client.get("/").text
    assert client.get("/api/meta").status_code == 200
