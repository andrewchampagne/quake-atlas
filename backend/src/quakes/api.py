"""FastAPI application.

Endpoints
---------
``GET /api/events``         Apache Arrow IPC stream of matching events (columnar, binary).
``GET /api/events/{rid}``   Full details for one event.
``GET /api/summary``        Total, strongest event and counts per year.
``GET /api/meta``           Dataset bounds and available sources.

``/api/events`` and ``/api/summary`` share the filter parameters ``start``,
``end`` (epoch ms, end exclusive), ``min_mag``, ``max_mag``, ``min_depth``,
``max_depth`` and ``sources`` (repeatable or comma-separated).

Run with ``uvicorn quakes.api:app``. If ``frontend/dist`` exists it is served at ``/``.
"""

from __future__ import annotations

import gzip
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated

import pyarrow as pa
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from quakes.cache import LRUCache
from quakes.config import Settings
from quakes.models import EventDetail, Meta, Summary
from quakes.query import Filters, QuakeStore

log = logging.getLogger(__name__)

ARROW_MIME = "application/vnd.apache.arrow.stream"
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
EXPOSED_HEADERS = ["X-Total-Count", "X-Returned-Count", "X-Downsampled", "X-Min-Mag-Returned"]


@dataclass(frozen=True)
class EventsPayload:
    """Serialised events response, stored raw and gzipped."""

    raw: bytes
    gz: bytes
    headers: dict[str, str]

    @property
    def nbytes(self) -> int:
        return len(self.raw) + len(self.gz)


def serialize_arrow(table: pa.Table) -> bytes:
    """Encode a table as an Arrow IPC stream."""
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


class AppState:
    """Mutable per-app state: the store (loaded lazily) and the payload cache."""

    def __init__(self, settings: Settings, store: QuakeStore | None) -> None:
        self.settings = settings
        self.store = store
        self.payload_cache: LRUCache[Filters, EventsPayload] = LRUCache(
            max_items=64, max_bytes=512 * 1024 * 1024, sizeof=lambda p: p.nbytes
        )

    def load(self) -> None:
        if self.store is None and self.settings.parquet_path.exists():
            log.info("Loading %s", self.settings.parquet_path)
            self.store = QuakeStore(self.settings.parquet_path)


# Dependencies live at module level so FastAPI can resolve their annotations.


def get_state(request: Request) -> AppState:
    return request.app.state.quakes


def get_store(state: Annotated[AppState, Depends(get_state)]) -> QuakeStore:
    if state.store is None:
        state.load()
    if state.store is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No processed dataset at {state.settings.parquet_path}. "
                "Run `make sample` (or `uv run quakes sample`) first."
            ),
        )
    return state.store


def get_filters(
    start: Annotated[int | None, Query(description="Epoch ms, inclusive")] = None,
    end: Annotated[int | None, Query(description="Epoch ms, exclusive")] = None,
    min_mag: float | None = None,
    max_mag: float | None = None,
    min_depth: float | None = None,
    max_depth: float | None = None,
    sources: Annotated[
        list[str] | None, Query(description="Repeatable or comma-separated source ids")
    ] = None,
) -> Filters:
    parsed = None
    if sources is not None:
        parsed = tuple(s.strip() for raw in sources for s in raw.split(",") if s.strip())
    try:
        return Filters(start, end, min_mag, max_mag, min_depth, max_depth, parsed)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


StateDep = Annotated[AppState, Depends(get_state)]
StoreDep = Annotated[QuakeStore, Depends(get_store)]
FiltersDep = Annotated[Filters, Depends(get_filters)]


def create_app(settings: Settings | None = None, store: QuakeStore | None = None) -> FastAPI:
    """Build the app. Pass ``store`` to inject data (tests); otherwise it loads from disk."""
    settings = settings or Settings.from_env()
    state = AppState(settings, store)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        state.load()
        yield
        if state.store is not None:
            state.store.close()

    app = FastAPI(
        title="Quakes API",
        version="0.1.0",
        summary="Historical earthquake catalog (USGS ComCat + NOAA NCEI).",
        lifespan=lifespan,
    )
    app.state.quakes = state
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_methods=["GET"],
        allow_headers=["*"],
        expose_headers=EXPOSED_HEADERS,
    )

    @app.get(
        "/api/events",
        response_class=Response,
        responses={200: {"content": {ARROW_MIME: {}}, "description": "Arrow IPC stream"}},
    )
    def events(request: Request, filters: FiltersDep, store: StoreDep, state: StateDep) -> Response:
        """Matching events as an Arrow IPC stream.

        Columns: ``rid`` uint32, ``time`` float64 (epoch ms), ``lon``/``lat``/
        ``depth_km`` (NaN = unknown)/``magnitude`` float32, ``source`` uint8.
        When more than ``max_points`` events match, only the strongest are
        returned and ``X-Downsampled: 1`` is set.
        """

        def build() -> EventsPayload:
            result = store.events(filters, settings.max_points)
            raw = serialize_arrow(result.table)
            headers = {
                "X-Total-Count": str(result.total),
                "X-Returned-Count": str(result.returned),
                "X-Downsampled": "1" if result.downsampled else "0",
            }
            if result.min_mag_returned is not None:
                headers["X-Min-Mag-Returned"] = f"{result.min_mag_returned:.2f}"
            return EventsPayload(raw, gzip.compress(raw, compresslevel=6), headers)

        payload = state.payload_cache.get_or_compute(filters, build)
        headers = {**payload.headers, "Vary": "Accept-Encoding", "Cache-Control": "no-cache"}
        body = payload.raw
        if "gzip" in request.headers.get("accept-encoding", "").lower():
            body = payload.gz
            headers["Content-Encoding"] = "gzip"
        return Response(content=body, media_type=ARROW_MIME, headers=headers)

    @app.get("/api/events/{rid}", response_model=EventDetail)
    def event_detail(rid: int, store: StoreDep) -> EventDetail:
        """Full details for one event, used by hover tooltips and the pinned panel."""
        event = store.event(rid)
        if event is None:
            raise HTTPException(status_code=404, detail=f"No event with rid {rid}")
        return event

    @app.get("/api/summary", response_model=Summary)
    def summary(filters: FiltersDep, store: StoreDep) -> Summary:
        """Total count, strongest event and counts per year for the filters."""
        return store.summary(filters)

    @app.get("/api/meta", response_model=Meta)
    def meta(store: StoreDep) -> Meta:
        """Dataset bounds (time, magnitude, depth) and available sources."""
        return store.meta(settings.max_points)

    if settings.frontend_dist.is_dir():
        app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")

    return app


app = create_app()
