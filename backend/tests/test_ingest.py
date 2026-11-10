"""Ingest tests against a fake FDSN/Hazel server (httpx.MockTransport); no network."""

from __future__ import annotations

import itertools
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from quakes import ingest
from quakes.ingest import IngestError, RetryPolicy, Window

HEADER = "time,latitude,longitude,depth,mag,magType,id,place,type\n"


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=UTC)


class FakeUSGS:
    """Events are spread uniformly at ``per_day`` events per day."""

    def __init__(self, per_day: float) -> None:
        self.per_day = per_day
        self.calls: Counter[str] = Counter()
        self.queries: list[tuple[str, str]] = []

    def count(self, start: datetime, end: datetime) -> int:
        return int((end - start).total_seconds() / 86400 * self.per_day)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        endpoint = request.url.path.rsplit("/", 1)[-1]
        self.calls[endpoint] += 1
        p = request.url.params
        start, end = _parse(p["starttime"]), _parse(p["endtime"])
        n = self.count(start, end)
        if endpoint == "count":
            return httpx.Response(200, json={"count": n, "maxAllowed": 20000})
        assert n <= 20000, "query would exceed the USGS limit"
        self.queries.append((p["starttime"], p["endtime"]))
        if n == 0:
            return httpx.Response(204)
        row = f"{p['starttime']}Z,0,0,10,5.0,mb,id-{p['starttime']},somewhere,earthquake\n"
        return httpx.Response(200, text=HEADER + row)


def _client(handler: httpx.MockTransport | object) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]


def _no_sleep() -> RetryPolicy:
    return RetryPolicy(max_attempts=4, base_delay=0.01, sleep=lambda _s: None)


NOW = datetime(2026, 11, 9, tzinfo=UTC)


def test_window_split_and_slug() -> None:
    w = Window(datetime(2020, 1, 1, tzinfo=UTC), datetime(2021, 1, 1, tzinfo=UTC))
    a, b = w.split()
    assert a.start == w.start and b.end == w.end and a.end == b.start
    assert a.slug == "20200101T000000_20200702T000000"  # 2020 is a leap year: 366 / 2 days
    assert w.params() == {"starttime": "2020-01-01T00:00:00", "endtime": "2021-01-01T00:00:00"}


def test_plan_windows_subdivides_until_under_limit() -> None:
    fake = FakeUSGS(per_day=150)  # ~55k events / year
    year = Window(datetime(2020, 1, 1, tzinfo=UTC), datetime(2021, 1, 1, tzinfo=UTC))
    plan = ingest.plan_windows(_client(fake), year, 2.5, _no_sleep())
    assert all(n <= ingest.USGS_LIMIT for _, n in plan)
    assert len(plan) == 4  # 55k -> 2x27k -> 4x14k
    assert plan[0][0].start == year.start and plan[-1][0].end == year.end
    assert all(a.end == b.start for (a, _), (b, _) in itertools.pairwise(plan))


def test_ingest_usgs_downloads_and_marks_years_complete(tmp_path: Path) -> None:
    fake = FakeUSGS(per_day=100)  # 36.5k per year -> 2 chunks
    stats = ingest.ingest_usgs(
        2019, 2020, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW
    )
    assert stats.chunks_downloaded == 4 and fake.calls["query"] == 4
    for year in (2019, 2020):
        ydir = tmp_path / "usgs" / "m5" / str(year)
        assert (ydir / ingest.COMPLETE_MARKER).exists()
        assert len(list(ydir.glob("*.csv"))) == 2
    assert not list(tmp_path.rglob("*.part"))


def test_resume_skips_complete_years_without_requests(tmp_path: Path) -> None:
    fake = FakeUSGS(per_day=10)
    ingest.ingest_usgs(2019, 2020, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW)
    fake.calls.clear()
    stats = ingest.ingest_usgs(
        2019, 2020, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW
    )
    assert stats.years_skipped == 2 and sum(fake.calls.values()) == 0


def test_resume_redownloads_only_missing_chunks(tmp_path: Path) -> None:
    fake = FakeUSGS(per_day=100)
    ingest.ingest_usgs(2020, 2020, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW)
    ydir = tmp_path / "usgs" / "m5" / "2020"
    (ydir / ingest.COMPLETE_MARKER).unlink()
    first, second = sorted(ydir.glob("*.csv"))
    second.unlink()  # simulate an interrupted run
    fake.queries.clear()
    stats = ingest.ingest_usgs(
        2020, 2020, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW
    )
    assert stats.chunks_skipped == 1 and stats.chunks_downloaded == 1
    assert len(fake.queries) == 1 and second.exists() and first.exists()


def test_recent_windows_are_refreshed_and_year_left_incomplete(tmp_path: Path) -> None:
    fake = FakeUSGS(per_day=10)
    now = datetime(2026, 6, 15, tzinfo=UTC)
    kwargs = {"client": _client(fake), "policy": _no_sleep(), "now": now}
    ingest.ingest_usgs(2026, 2026, 5.0, tmp_path, **kwargs)  # type: ignore[arg-type]
    assert not (tmp_path / "usgs" / "m5" / "2026" / ingest.COMPLETE_MARKER).exists()
    fake.queries.clear()
    ingest.ingest_usgs(2026, 2026, 5.0, tmp_path, **kwargs)  # type: ignore[arg-type]
    assert len(fake.queries) == 1  # the open-ended window is fetched again


def test_future_years_are_skipped(tmp_path: Path) -> None:
    fake = FakeUSGS(per_day=10)
    ingest.ingest_usgs(2027, 2030, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW)
    assert sum(fake.calls.values()) == 0


def test_empty_window_writes_empty_file(tmp_path: Path) -> None:
    fake = FakeUSGS(per_day=0)
    ingest.ingest_usgs(1901, 1901, 7.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW)
    files = list((tmp_path / "usgs" / "m7" / "1901").glob("*.csv"))
    assert len(files) == 1 and files[0].stat().st_size == 0
    assert fake.calls["query"] == 0


def test_superseded_chunks_are_removed(tmp_path: Path) -> None:
    ydir = tmp_path / "usgs" / "m5" / "2020"
    ydir.mkdir(parents=True)
    coarse = ydir / "20200101T000000_20210101T000000.csv"
    coarse.write_text(HEADER)
    fake = FakeUSGS(per_day=100)  # now needs two chunks
    ingest.ingest_usgs(2020, 2020, 5.0, tmp_path, client=_client(fake), policy=_no_sleep(), now=NOW)
    assert not coarse.exists()
    assert len(list(ydir.glob("*.csv"))) == 2


def test_retry_on_server_errors_honours_retry_after() -> None:
    responses = iter(
        [
            httpx.Response(503, headers={"Retry-After": "7"}),
            httpx.Response(429),
            httpx.Response(200, json={"ok": True}),
        ]
    )
    sleeps: list[float] = []
    policy = RetryPolicy(max_attempts=5, base_delay=1.0, sleep=sleeps.append)
    stats = ingest.IngestStats()
    resp = ingest.get_with_retry(
        _client(lambda _r: next(responses)), "https://x.test/", {}, policy, stats
    )
    assert resp.json() == {"ok": True}
    assert stats.requests == 3
    assert sleeps[0] == 7.0 and 1.0 <= sleeps[1] <= 2.0


def test_retry_on_transport_errors_then_give_up() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(IngestError):
        ingest.get_with_retry(_client(boom), "https://x.test/", {}, _no_sleep())


def test_client_errors_are_not_retried() -> None:
    calls = []

    def bad(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(400, text="Bad request")

    with pytest.raises(httpx.HTTPStatusError):
        ingest.get_with_retry(_client(bad), "https://x.test/", {}, _no_sleep())
    assert len(calls) == 1


def test_ingest_noaa_paginates_and_resumes(tmp_path: Path) -> None:
    pages: list[int] = []

    def hazel(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        pages.append(page)
        items = [{"id": page * 10 + i, "year": -100 * page} for i in range(2)]
        return httpx.Response(
            200, json={"items": items, "page": page, "totalPages": 3, "totalItems": 6}
        )

    stats = ingest.ingest_noaa(tmp_path, max_year=1899, client=_client(hazel), policy=_no_sleep())
    assert pages == [1, 2, 3] and stats.events_expected == 6
    out = ingest.noaa_dir(tmp_path, -2150, 1899)
    assert json.loads((out / "page_0002.json").read_text())["items"][0]["id"] == 20

    (out / "page_0003.json").unlink()
    pages.clear()
    stats = ingest.ingest_noaa(tmp_path, max_year=1899, client=_client(hazel), policy=_no_sleep())
    assert pages == [3] and stats.chunks_skipped == 2
