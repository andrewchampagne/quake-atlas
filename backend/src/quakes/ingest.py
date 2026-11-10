"""Download raw earthquake catalogs to ``data/raw``.

USGS ComCat (FDSN event service)
    Queried year by year. Before downloading a window we ask the ``count``
    endpoint how many events it holds; windows above the 20,000-event limit are
    split in half recursively until every piece fits. Each piece is written to
    ``raw/usgs/m<minmag>/<year>/<start>_<end>.csv`` atomically (temp file then
    rename), so an existing file is always complete. A ``_COMPLETE`` marker is
    written once a whole year is done, letting a resumed run skip that year
    without any network calls. Windows that end within the last 30 days are
    never treated as final because USGS keeps revising recent events.

NOAA NCEI Significant Earthquake Database (Hazel API)
    Paginated JSON, one file per page under ``raw/noaa/<minyear>_<maxyear>/``.

All requests retry with exponential backoff (honouring ``Retry-After``) on
transport errors, 429 and 5xx responses.
"""

from __future__ import annotations

import json
import logging
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from quakes.config import COUNTRIES_FILE, NATURAL_EARTH_BASE, PLACES_FILE, USER_AGENT

log = logging.getLogger(__name__)

USGS_BASE = "https://earthquake.usgs.gov/fdsnws/event/1/"
NOAA_URL = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes"

#: Maximum events the USGS service returns for one query.
USGS_LIMIT = 20_000
#: Windows ending this close to "now" are re-downloaded on every run.
RECENT_WINDOW = timedelta(days=30)
#: Never split a window below this span (guards against pathological recursion).
MIN_WINDOW = timedelta(minutes=1)
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
COMPLETE_MARKER = "_COMPLETE"


class IngestError(RuntimeError):
    """Raised when a request keeps failing after all retries."""


@dataclass
class RetryPolicy:
    """Exponential backoff with jitter. ``sleep`` is injectable for tests."""

    max_attempts: int = 6
    base_delay: float = 1.0
    max_delay: float = 60.0
    sleep: Callable[[float], None] = time.sleep

    def delay(self, attempt: int, retry_after: str | None = None) -> float:
        """Seconds to wait before retry number ``attempt`` (0-based)."""
        if retry_after:
            try:
                return min(max(float(retry_after), 0.0), self.max_delay)
            except ValueError:
                pass  # HTTP-date form: fall back to exponential backoff
        backoff = min(self.base_delay * 2**attempt, self.max_delay)
        return backoff * (0.5 + random.random() / 2)


@dataclass
class IngestStats:
    """Counters reported at the end of an ingest run."""

    requests: int = 0
    chunks_downloaded: int = 0
    chunks_skipped: int = 0
    years_skipped: int = 0
    events_expected: int = 0
    files: list[Path] = field(default_factory=list)


def make_client(timeout: float = 120.0) -> httpx.Client:
    """HTTP client with a generic User-Agent and generous read timeout."""
    return httpx.Client(
        timeout=httpx.Timeout(timeout, connect=20.0),
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )


def get_with_retry(
    client: httpx.Client,
    url: str,
    params: dict[str, str | int | float],
    policy: RetryPolicy,
    stats: IngestStats | None = None,
) -> httpx.Response:
    """GET ``url`` with retries. Returns the response for 2xx; raises otherwise."""
    last_error: Exception | None = None
    for attempt in range(policy.max_attempts):
        if stats is not None:
            stats.requests += 1
        try:
            resp = client.get(url, params=params)
        except httpx.TransportError as exc:
            last_error = exc
            wait = policy.delay(attempt)
            log.warning("Network error (%s); retrying in %.1fs", exc, wait)
        else:
            if resp.status_code not in RETRY_STATUSES:
                resp.raise_for_status()
                return resp
            last_error = httpx.HTTPStatusError(
                f"HTTP {resp.status_code}", request=resp.request, response=resp
            )
            wait = policy.delay(attempt, resp.headers.get("Retry-After"))
            log.warning("HTTP %s from %s; retrying in %.1fs", resp.status_code, url, wait)
        if attempt < policy.max_attempts - 1:
            policy.sleep(wait)
    raise IngestError(f"Giving up on {url} {params} after {policy.max_attempts} attempts") from (
        last_error
    )


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(path)


# --------------------------------------------------------------------------- USGS


@dataclass(frozen=True)
class Window:
    """Half-open UTC time window ``[start, end)``."""

    start: datetime
    end: datetime

    @property
    def span(self) -> timedelta:
        return self.end - self.start

    @property
    def slug(self) -> str:
        return f"{self.start:%Y%m%dT%H%M%S}_{self.end:%Y%m%dT%H%M%S}"

    def split(self) -> tuple[Window, Window]:
        mid = self.start + timedelta(seconds=int(self.span.total_seconds() // 2))
        return Window(self.start, mid), Window(mid, self.end)

    def params(self) -> dict[str, str]:
        fmt = "%Y-%m-%dT%H:%M:%S"
        return {"starttime": self.start.strftime(fmt), "endtime": self.end.strftime(fmt)}


def usgs_dir(raw_dir: Path, min_mag: float) -> Path:
    """Directory holding USGS chunks downloaded with a given magnitude floor."""
    return raw_dir / "usgs" / f"m{min_mag:g}"


def count_usgs(
    client: httpx.Client,
    window: Window,
    min_mag: float,
    policy: RetryPolicy,
    stats: IngestStats | None = None,
) -> int:
    """Number of earthquakes in ``window`` with magnitude >= ``min_mag``."""
    params = {**window.params(), "minmagnitude": min_mag, "eventtype": "earthquake"}
    params["format"] = "geojson"
    resp = get_with_retry(client, USGS_BASE + "count", params, policy, stats)
    return int(resp.json()["count"])


def plan_windows(
    client: httpx.Client,
    window: Window,
    min_mag: float,
    policy: RetryPolicy,
    stats: IngestStats | None = None,
    limit: int = USGS_LIMIT,
) -> list[tuple[Window, int]]:
    """Split ``window`` until every piece holds at most ``limit`` events.

    Returns ``(window, count)`` pairs in chronological order.
    """
    n = count_usgs(client, window, min_mag, policy, stats)
    if n <= limit or window.span <= MIN_WINDOW:
        return [(window, n)]
    log.info("  %s holds %d events (> %d); splitting", window.slug, n, limit)
    left, right = window.split()
    return plan_windows(client, left, min_mag, policy, stats, limit) + plan_windows(
        client, right, min_mag, policy, stats, limit
    )


def download_usgs_window(
    client: httpx.Client,
    window: Window,
    min_mag: float,
    path: Path,
    policy: RetryPolicy,
    stats: IngestStats | None = None,
) -> None:
    """Download one window as CSV to ``path`` (written atomically)."""
    params = {
        **window.params(),
        "minmagnitude": min_mag,
        "eventtype": "earthquake",
        "orderby": "time-asc",
        "format": "csv",
    }
    resp = get_with_retry(client, USGS_BASE + "query", params, policy, stats)
    # FDSN answers 204 No Content when nothing matches: keep an empty marker file.
    _atomic_write(path, resp.content if resp.status_code != 204 else b"")


def ingest_usgs(
    start_year: int,
    end_year: int,
    min_mag: float,
    raw_dir: Path,
    *,
    client: httpx.Client | None = None,
    policy: RetryPolicy | None = None,
    now: datetime | None = None,
    limit: int = USGS_LIMIT,
) -> IngestStats:
    """Download USGS ComCat events for ``start_year..end_year`` inclusive. Resumable."""
    policy = policy or RetryPolicy()
    now = now or datetime.now(UTC)
    stats = IngestStats()
    own_client = client is None
    client = client or make_client()
    base = usgs_dir(raw_dir, min_mag)
    try:
        for year in range(start_year, end_year + 1):
            year_window = Window(
                datetime(year, 1, 1, tzinfo=UTC), datetime(year + 1, 1, 1, tzinfo=UTC)
            )
            if year_window.start >= now:
                break
            ydir = base / str(year)
            marker = ydir / COMPLETE_MARKER
            if marker.exists():
                stats.years_skipped += 1
                continue
            log.info("USGS %d (M%g+)", year, min_mag)
            planned = plan_windows(client, year_window, min_mag, policy, stats, limit)
            for window, n in planned:
                stats.events_expected += n
                path = ydir / f"{window.slug}.csv"
                final = window.end <= now - RECENT_WINDOW
                if final and path.exists():
                    stats.chunks_skipped += 1
                    continue
                if n == 0:
                    _atomic_write(path, b"")
                else:
                    download_usgs_window(client, window, min_mag, path, policy, stats)
                    log.info("  %s: %d events", window.slug, n)
                stats.chunks_downloaded += 1
                stats.files.append(path)
            _remove_superseded(ydir, {f"{w.slug}.csv" for w, _ in planned})
            if year_window.end <= now - RECENT_WINDOW:
                marker.write_text(
                    json.dumps({"year": year, "min_mag": min_mag, "at": now.isoformat()}),
                    encoding="utf-8",
                )
    finally:
        if own_client:
            client.close()
    return stats


def _remove_superseded(ydir: Path, keep: set[str]) -> None:
    """Delete chunk files in ``ydir`` that are not part of the current plan.

    The planned windows tile the whole year, so any other CSV (for example a
    coarse chunk that has since grown past the limit and been split) overlaps
    them and is redundant.
    """
    for stale in ydir.glob("*.csv"):
        if stale.name not in keep:
            log.info("  removing superseded chunk %s", stale.name)
            stale.unlink()


# --------------------------------------------------------------------------- Natural Earth


def places_dir(raw_dir: Path) -> Path:
    return raw_dir / "places"


def ingest_places(
    raw_dir: Path,
    *,
    client: httpx.Client | None = None,
    policy: RetryPolicy | None = None,
    force: bool = False,
) -> IngestStats:
    """Download Natural Earth populated places and countries (used for exposure). Resumable."""
    policy = policy or RetryPolicy()
    stats = IngestStats()
    own_client = client is None
    client = client or make_client()
    try:
        for name in (PLACES_FILE, COUNTRIES_FILE):
            path = places_dir(raw_dir) / name
            if path.exists() and not force:
                stats.chunks_skipped += 1
                continue
            resp = get_with_retry(client, NATURAL_EARTH_BASE + name, {}, policy, stats)
            _atomic_write(path, resp.content)
            stats.chunks_downloaded += 1
            stats.files.append(path)
            log.info("Natural Earth: %s (%.1f MB)", name, len(resp.content) / 1e6)
    finally:
        if own_client:
            client.close()
    return stats


# --------------------------------------------------------------------------- NOAA


def noaa_dir(raw_dir: Path, min_year: int, max_year: int) -> Path:
    return raw_dir / "noaa" / f"{min_year}_{max_year}"


def ingest_noaa(
    raw_dir: Path,
    *,
    min_year: int = -2150,
    max_year: int | None = None,
    client: httpx.Client | None = None,
    policy: RetryPolicy | None = None,
    force: bool = False,
) -> IngestStats:
    """Download the NOAA Significant Earthquake Database between two years. Resumable.

    The default range runs to the current year: records before 1900 become map
    events, later ones supply death tolls for matching USGS events.
    """
    max_year = max_year if max_year is not None else datetime.now(UTC).year
    policy = policy or RetryPolicy()
    stats = IngestStats()
    own_client = client is None
    client = client or make_client()
    out = noaa_dir(raw_dir, min_year, max_year)
    try:
        page, total_pages = 1, 1
        while page <= total_pages:
            path = out / f"page_{page:04d}.json"
            if path.exists() and not force:
                payload = json.loads(path.read_text(encoding="utf-8"))
                stats.chunks_skipped += 1
            else:
                params = {"minYear": min_year, "maxYear": max_year, "page": page}
                resp = get_with_retry(client, NOAA_URL, params, policy, stats)
                payload = resp.json()
                _atomic_write(path, json.dumps(payload).encode("utf-8"))
                stats.chunks_downloaded += 1
                stats.files.append(path)
            total_pages = int(payload.get("totalPages") or 1)
            if page == 1:
                stats.events_expected = int(payload.get("totalItems") or 0)
                log.info(
                    "NOAA %d..%d: %d events in %d pages",
                    min_year,
                    max_year,
                    stats.events_expected,
                    total_pages,
                )
            page += 1
    finally:
        if own_client:
            client.close()
    return stats
