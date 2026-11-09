"""DuckDB-backed filtering and aggregation over the cleaned catalog.

The Parquet file is loaded once into an in-memory DuckDB table (a couple of
million rows fit comfortably). Time is stored as ``time_ms`` (BIGINT epoch
milliseconds) so BCE dates need no special handling. Each query runs on its own
cursor, which makes :class:`QuakeStore` safe to share across request threads.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from quakes import timeutil
from quakes.cache import LRUCache
from quakes.config import SOURCE_LABELS, SOURCES
from quakes.models import EventDetail, Meta, Range, SourceInfo, StrongestEvent, Summary, YearCount

#: Columns of the binary ``/api/events`` payload, in order.
EVENT_COLUMNS = ("rid", "time", "lon", "lat", "depth_km", "magnitude", "source")


@dataclass(frozen=True)
class Filters:
    """Normalised, hashable query filters. ``None`` means "unbounded".

    Depth semantics: events with unknown depth are included only when neither
    ``min_depth`` nor ``max_depth`` is given.
    """

    start: int | None = None
    end: int | None = None
    min_mag: float | None = None
    max_mag: float | None = None
    min_depth: float | None = None
    max_depth: float | None = None
    sources: tuple[str, ...] | None = field(default=None)

    def __post_init__(self) -> None:
        for lo, hi, name in (
            (self.start, self.end, "start/end"),
            (self.min_mag, self.max_mag, "min_mag/max_mag"),
            (self.min_depth, self.max_depth, "min_depth/max_depth"),
        ):
            if lo is not None and hi is not None and lo > hi:
                raise ValueError(f"{name}: lower bound is greater than upper bound")
        for value in (self.min_mag, self.max_mag, self.min_depth, self.max_depth):
            if value is not None and not math.isfinite(value):
                raise ValueError("filter bounds must be finite numbers")
        if self.sources is not None:
            unknown = set(self.sources) - SOURCES.keys()
            if unknown:
                raise ValueError(f"unknown source(s): {', '.join(sorted(unknown))}")
            object.__setattr__(self, "sources", tuple(sorted(set(self.sources))))

    def where(self) -> tuple[str, list[object]]:
        """SQL ``WHERE`` clause and positional parameters."""
        clauses: list[str] = []
        params: list[object] = []

        def add(clause: str, value: object) -> None:
            clauses.append(clause)
            params.append(value)

        if self.start is not None:
            add("time_ms >= ?", self.start)
        if self.end is not None:
            add("time_ms < ?", self.end)
        # magnitude/depth are FLOAT (float32): cast the bound too, otherwise
        # 5.1::FLOAT (5.0999999) >= 5.1::DOUBLE is false and M5.1 events vanish.
        if self.min_mag is not None:
            add("magnitude >= ?::FLOAT", self.min_mag)
        if self.max_mag is not None:
            add("magnitude <= ?::FLOAT", self.max_mag)
        if self.min_depth is not None or self.max_depth is not None:
            clauses.append("depth_km IS NOT NULL")
            if self.min_depth is not None:
                add("depth_km >= ?::FLOAT", self.min_depth)
            if self.max_depth is not None:
                add("depth_km <= ?::FLOAT", self.max_depth)
        if self.sources is not None:
            if not self.sources:
                clauses.append("FALSE")
            else:
                clauses.append(f"source IN ({', '.join('?' * len(self.sources))})")
                params.extend(self.sources)
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


@dataclass(frozen=True)
class EventsResult:
    """Columnar events plus downsampling metadata."""

    table: pa.Table
    total: int
    downsampled: bool
    min_mag_returned: float | None

    @property
    def returned(self) -> int:
        return self.table.num_rows


def event_url(event_id: str, source: str) -> str | None:
    """Link to the event's page at its source agency."""
    if source == "usgs":
        return f"https://earthquake.usgs.gov/earthquakes/eventpage/{event_id}"
    if source == "noaa" and event_id.startswith("noaa-"):
        noaa_id = event_id.removeprefix("noaa-")
        return f"https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/event-more-info/{noaa_id}"
    return None


def _source_case() -> str:
    whens = " ".join(f"WHEN '{name}' THEN {code}" for name, code in SOURCES.items())
    return f"CASE source {whens} ELSE 255 END::UTINYINT"


def _opt_float(value: object) -> float | None:
    if value is None:
        return None
    f = float(value)  # type: ignore[arg-type]
    return None if math.isnan(f) else f


class QuakeStore:
    """Query interface over the cleaned Parquet catalog."""

    def __init__(self, parquet_path: Path, *, summary_cache_size: int = 256) -> None:
        self.parquet_path = parquet_path
        self._con = duckdb.connect(":memory:")
        table = pq.read_table(parquet_path)
        time_ms = table.column("time").cast(pa.int64())
        table = table.set_column(table.schema.get_field_index("time"), "time_ms", time_ms)
        self._con.register("src", table)
        self._con.execute("CREATE TABLE quakes AS SELECT * FROM src ORDER BY time_ms")
        self._con.unregister("src")
        self._summary_cache: LRUCache[Filters, Summary] = LRUCache(summary_cache_size)

    def _cursor(self) -> duckdb.DuckDBPyConnection:
        return self._con.cursor()

    def count(self, filters: Filters) -> int:
        where, params = filters.where()
        row = self._cursor().execute(f"SELECT count(*) FROM quakes{where}", params).fetchone()
        return int(row[0]) if row else 0

    def events(self, filters: Filters, max_points: int | None = None) -> EventsResult:
        """Matching events as an Arrow table with :data:`EVENT_COLUMNS`.

        If more than ``max_points`` events match, only the ``max_points``
        strongest are returned (ties broken by ``rid``), which is equivalent to
        raising the minimum magnitude. Rows are ordered by descending magnitude
        so small events draw on top of large ones.
        """
        total = self.count(filters)
        where, params = filters.where()
        sql = f"""
            SELECT rid::UINTEGER            AS rid,
                   time_ms::DOUBLE          AS time,
                   longitude::FLOAT         AS lon,
                   latitude::FLOAT          AS lat,
                   coalesce(depth_km, 'NaN'::FLOAT)::FLOAT AS depth_km,
                   magnitude::FLOAT         AS magnitude,
                   {_source_case()}         AS source
            FROM quakes{where}
            ORDER BY magnitude DESC, rid
        """
        downsampled = max_points is not None and total > max_points
        if downsampled:
            sql += " LIMIT ?"
            params = [*params, max_points]
        table = self._cursor().sql(sql, params=params).to_arrow_table()
        table = table.cast(
            pa.schema(
                [
                    pa.field("rid", pa.uint32(), nullable=False),
                    pa.field("time", pa.float64(), nullable=False),
                    pa.field("lon", pa.float32(), nullable=False),
                    pa.field("lat", pa.float32(), nullable=False),
                    pa.field("depth_km", pa.float32(), nullable=False),
                    pa.field("magnitude", pa.float32(), nullable=False),
                    pa.field("source", pa.uint8(), nullable=False),
                ]
            )
        )
        min_mag = None
        if downsampled and table.num_rows:
            min_mag = float(table.column("magnitude")[-1].as_py())
        return EventsResult(table, total, downsampled, min_mag)

    def event(self, rid: int) -> EventDetail | None:
        """Full record for one event, or ``None`` if ``rid`` does not exist."""
        row = (
            self._cursor()
            .execute(
                """SELECT rid, event_id, time_ms, year, latitude, longitude, depth_km,
                          magnitude, mag_type, place, source
                   FROM quakes WHERE rid = ?""",
                [rid],
            )
            .fetchone()
        )
        if row is None:
            return None
        rid_, event_id, time_ms, year, lat, lon, depth, mag, mag_type, place, source = row
        # NOAA times are often only known to the day (or year): omit the clock time.
        label = timeutil.format_time(time_ms, with_time=source != "noaa")
        return EventDetail(
            rid=rid_,
            event_id=event_id,
            time=time_ms,
            time_label=label,
            year=year,
            latitude=lat,
            longitude=lon,
            depth_km=_opt_float(depth),
            magnitude=round(float(mag), 2),
            mag_type=mag_type,
            place=place,
            source=source,
            url=event_url(event_id, source),
        )

    def summary(self, filters: Filters) -> Summary:
        """Total, strongest event and counts per year (cached per filter set)."""
        return self._summary_cache.get_or_compute(filters, lambda: self._summary(filters))

    def _summary(self, filters: Filters) -> Summary:
        where, params = filters.where()
        cur = self._cursor()
        per_year = cur.execute(
            f"SELECT year, count(*) FROM quakes{where} GROUP BY year ORDER BY year", params
        ).fetchall()
        strongest_row = cur.execute(
            f"""SELECT rid, event_id, time_ms, latitude, longitude, depth_km, magnitude,
                       place, source
                FROM quakes{where}
                ORDER BY magnitude DESC, (source = 'noaa'), time_ms, rid LIMIT 1""",
            params,
        ).fetchone()
        strongest = None
        if strongest_row is not None:
            rid, event_id, time_ms, lat, lon, depth, mag, place, source = strongest_row
            strongest = StrongestEvent(
                rid=rid,
                event_id=event_id,
                time=time_ms,
                latitude=lat,
                longitude=lon,
                depth_km=_opt_float(depth),
                magnitude=round(float(mag), 2),
                place=place,
                source=source,
            )
        counts = [YearCount(year=y, count=c) for y, c in per_year]
        return Summary(total=sum(c.count for c in counts), strongest=strongest, per_year=counts)

    def meta(self, max_points: int) -> Meta:
        """Dataset bounds and per-source counts."""
        cur = self._cursor()
        row = cur.execute(
            """SELECT min(time_ms), max(time_ms), min(year), max(year),
                      min(magnitude), max(magnitude), min(depth_km), max(depth_km), count(*)
               FROM quakes"""
        ).fetchone()
        assert row is not None
        t0, t1, y0, y1, m0, m1, d0, d1, total = row
        counts = dict(cur.execute("SELECT source, count(*) FROM quakes GROUP BY source").fetchall())
        sources = [
            SourceInfo(id=name, code=code, label=SOURCE_LABELS[name], count=counts.get(name, 0))
            for name, code in SOURCES.items()
            if counts.get(name)
        ]
        return Meta(
            min_time=t0 or 0,
            max_time=t1 or 0,
            min_year=y0 or 0,
            max_year=y1 or 0,
            # Round away float32 noise (9.100000381 -> 9.1).
            magnitude=Range(
                min=round(_opt_float(m0) or 0.0, 2), max=round(_opt_float(m1) or 0.0, 2)
            ),
            depth=Range(min=round(_opt_float(d0) or 0.0, 2), max=round(_opt_float(d1) or 0.0, 2)),
            sources=sources,
            total=total,
            max_points=max_points,
        )

    def close(self) -> None:
        self._con.close()
