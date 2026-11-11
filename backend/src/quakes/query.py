"""DuckDB-backed filtering and aggregation over the cleaned catalog.

The Parquet file is loaded once into an in-memory DuckDB table (a couple of
million rows fit comfortably). Time is stored as ``time_ms`` (BIGINT epoch
milliseconds) so BCE dates need no special handling. Each query runs on its own
cursor, which makes :class:`QuakeStore` safe to share across request threads.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from quakes import aftershocks, timeutil
from quakes import families as fam
from quakes.cache import LRUCache
from quakes.config import FAMILIES_FILE, SOURCE_LABELS, SOURCES
from quakes.models import (
    AftershockForecast,
    Analog,
    AnalogSummary,
    EventDetail,
    Family,
    FamilyEvent,
    FamilyMembers,
    FamilyStats,
    GenerationCount,
    Histogram,
    Histogram2D,
    LargestFamily,
    Meta,
    NearestNeighbour,
    Range,
    Recurrence,
    SourceInfo,
    StrongestEvent,
    Summary,
    YearCount,
)

log = logging.getLogger(__name__)

#: Columns of the binary ``/api/events`` payload, in order.
EVENT_COLUMNS = ("rid", "time", "lon", "lat", "depth_km", "magnitude", "source", "deaths", "role")

#: Family members returned at most by :meth:`QuakeStore.family` (strongest first beyond this).
MAX_FAMILY_MEMBERS = 5000
#: Smallest mainshock offered an aftershock forecast.
FORECAST_MIN_MAGNITUDE = 6.5
MS_PER_DAY = 86_400_000

#: Family columns joined onto the catalog, with their types when no families exist.
FAMILY_COLUMNS = {
    "parent_rid": "UINTEGER",
    "nn_parent_rid": "UINTEGER",
    "log_eta": "FLOAT",
    "log_t": "FLOAT",
    "log_r": "FLOAT",
    "cluster_id": "UINTEGER",
    "mainshock_rid": "UINTEGER",
    "generation": "UINTEGER",
    "family_size": "UINTEGER",
}

#: SQL predicate for "at least one recorded death".
DEADLY_SQL = "(coalesce(deaths, 0) >= 1 OR coalesce(deaths_order, 0) >= 1)"

ORDER_LABELS = {
    0: "None recorded",
    1: "About 1-50 (approximate)",
    2: "About 51-100 (approximate)",
    3: "About 101-1,000 (approximate)",
    4: "Over 1,000 (approximate)",
}


def deaths_label(deaths: int | None, order: int | None) -> str:
    """``"18,428"``, ``"About 101-1,000 (approximate)"`` or ``"None recorded"``."""
    if deaths is not None:
        return "None recorded" if deaths == 0 else f"{deaths:,}"
    if order is not None:
        return ORDER_LABELS.get(order, "Unknown")
    return "Unknown / not reported"


@dataclass(frozen=True)
class Filters:
    """Normalised, hashable query filters. ``None`` means "unbounded".

    Depth semantics: events with unknown depth are included only when neither
    ``min_depth`` nor ``max_depth`` is given. ``deadly_only`` keeps events with
    at least one recorded death. ``declustered`` drops foreshocks and aftershocks
    (events never analysed for families, such as NOAA records, are kept).
    """

    start: int | None = None
    end: int | None = None
    min_mag: float | None = None
    max_mag: float | None = None
    min_depth: float | None = None
    max_depth: float | None = None
    sources: tuple[str, ...] | None = field(default=None)
    deadly_only: bool = False
    declustered: bool = False

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
        if self.deadly_only:
            clauses.append(DEADLY_SQL)
        if self.declustered:
            clauses.append(f"role NOT IN ({', '.join(map(str, fam.DEPENDENT_ROLES))})")
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


def _rounded(value: object, digits: int = 3) -> float | None:
    f = _opt_float(value)
    return None if f is None else round(f, digits)


def _opt_int(value: object) -> int | None:
    return None if value is None else int(value)  # type: ignore[call-overload]


def _distance_sql() -> str:
    """Great-circle distance (km) from a point given as two parameters (lat, lon)."""
    return (
        "2 * 6371.0 * asin(sqrt(least(1.0, "
        "pow(sin(radians(latitude - $lat) / 2), 2) + "
        "cos(radians($lat)) * cos(radians(latitude)) * "
        "pow(sin(radians(longitude - $lon) / 2), 2))))"
    )


def _bbox_sql(lat: float, radius_km: float) -> tuple[str, dict[str, float]]:
    """Cheap bounding-box prefilter for a circle (skips the longitude test near the poles)."""
    dlat = radius_km / 111.0
    params: dict[str, float] = {"lat0": lat - dlat, "lat1": lat + dlat}
    clause = "latitude BETWEEN $lat0 AND $lat1"
    cos_lat = math.cos(math.radians(lat))
    if cos_lat > 0.05:
        dlon = radius_km / (111.0 * cos_lat)
        if dlon < 180:
            # Wrap-around aware: compare the shortest angular longitude difference.
            clause += " AND abs(((longitude - $lon + 540) % 360) - 180) <= $dlon"
            params["dlon"] = dlon
    return clause, params


class QuakeStore:
    """Query interface over the cleaned Parquet catalog (plus families, when built)."""

    def __init__(
        self,
        parquet_path: Path,
        *,
        families_path: Path | None = None,
        summary_cache_size: int = 256,
    ) -> None:
        self.parquet_path = parquet_path
        self._con = duckdb.connect(":memory:")
        table = pq.read_table(parquet_path)
        time_ms = table.column("time").cast(pa.int64())
        table = table.set_column(table.schema.get_field_index("time"), "time_ms", time_ms)
        # Parquet written before death tolls existed: add empty columns.
        for name, dtype in (("deaths", pa.int32()), ("deaths_order", pa.int8())):
            if name not in table.column_names:
                table = table.append_column(name, pa.nulls(table.num_rows, type=dtype))
        self._con.register("src", table)
        self._con.execute("CREATE TABLE quakes AS SELECT * FROM src ORDER BY time_ms")
        self._con.unregister("src")
        self.families_info = self._attach_families(
            families_path or parquet_path.with_name(FAMILIES_FILE)
        )
        self._family_stats: FamilyStats | None = None
        self._summary_cache: LRUCache[Filters, Summary] = LRUCache(summary_cache_size)

    def _attach_families(self, path: Path) -> fam.FamiliesInfo | None:
        """Join ``families.parquet`` onto the catalog, unless it is missing or stale."""
        info, table = None, None
        if path.exists():
            try:
                table = pq.read_table(path)
                raw = (table.schema.metadata or {}).get(fam.METADATA_KEY)
                info = fam.FamiliesInfo.from_json(raw) if raw else None
            except (OSError, ValueError, TypeError) as exc:
                log.warning("Ignoring unreadable %s: %s", path, exc)
        if info is not None and table is not None:
            self._con.register("fam", table)
            [(mismatched,)] = self._con.execute(
                """SELECT count(*) FROM fam f LEFT JOIN quakes q USING (rid)
                   WHERE q.event_id IS DISTINCT FROM f.event_id"""
            ).fetchall()
            if mismatched:
                log.warning("%s was built for a different catalog; run quakes build-families", path)
                info = None
            else:
                columns = ", ".join(f"f.{name}" for name in FAMILY_COLUMNS)
                self._con.execute(
                    f"""CREATE OR REPLACE TABLE quakes AS
                        SELECT q.*, coalesce(f.role, 0)::UTINYINT AS role, {columns}
                        FROM quakes q LEFT JOIN fam f USING (rid) ORDER BY q.time_ms"""
                )
            self._con.unregister("fam")
        if info is None:
            self._con.execute("ALTER TABLE quakes ADD COLUMN role UTINYINT DEFAULT 0")
            for name, dtype in FAMILY_COLUMNS.items():
                self._con.execute(f"ALTER TABLE quakes ADD COLUMN {name} {dtype}")
        return info

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

        ``deaths`` is the exact recorded count; when only NOAA's order of
        magnitude is known it is ``-order`` (-1..-4); NaN means unknown.
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
                   {_source_case()}         AS source,
                   CASE WHEN deaths IS NOT NULL THEN deaths::FLOAT
                        WHEN deaths_order >= 1 THEN -deaths_order::FLOAT
                        WHEN deaths_order = 0 THEN 0::FLOAT
                        ELSE 'NaN'::FLOAT END AS deaths,
                   role::UTINYINT           AS role
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
                    pa.field("deaths", pa.float32(), nullable=False),
                    pa.field("role", pa.uint8(), nullable=False),
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
                          magnitude, mag_type, place, source, deaths, deaths_order
                   FROM quakes WHERE rid = ?""",
                [rid],
            )
            .fetchone()
        )
        if row is None:
            return None
        (rid_, event_id, time_ms, year, lat, lon, depth, mag, mag_type, place, source, d, o) = row
        # NOAA times are often only known to the day (or year): omit the clock time.
        label = timeutil.format_time(time_ms, with_time=source != "noaa")
        deaths, order = _opt_int(d), _opt_int(o)
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
            deaths=deaths,
            deaths_order=order,
            deaths_label=deaths_label(deaths, order),
        )

    def summary(self, filters: Filters) -> Summary:
        """Totals, strongest/deadliest events and per-year counts (cached per filter set)."""
        return self._summary_cache.get_or_compute(filters, lambda: self._summary(filters))

    def _event_row(self, where: str, params: list[object], order_by: str) -> StrongestEvent | None:
        row = (
            self._cursor()
            .execute(
                f"""SELECT rid, event_id, time_ms, latitude, longitude, depth_km, magnitude,
                           place, source, deaths, deaths_order
                    FROM quakes{where} ORDER BY {order_by} LIMIT 1""",
                params,
            )
            .fetchone()
        )
        if row is None:
            return None
        rid, event_id, time_ms, lat, lon, depth, mag, place, source, d, o = row
        return StrongestEvent(
            rid=rid,
            event_id=event_id,
            time=time_ms,
            latitude=lat,
            longitude=lon,
            depth_km=_opt_float(depth),
            magnitude=round(float(mag), 2),
            place=place,
            source=source,
            deaths=_opt_int(d),
            deaths_order=_opt_int(o),
        )

    def _summary(self, filters: Filters) -> Summary:
        where, params = filters.where()
        cur = self._cursor()
        per_year = cur.execute(
            f"""SELECT year, count(*), coalesce(sum(deaths), 0)
                FROM quakes{where} GROUP BY year ORDER BY year""",
            params,
        ).fetchall()
        totals = cur.execute(
            f"""SELECT coalesce(sum(deaths), 0),
                       count(*) FILTER (WHERE {DEADLY_SQL}),
                       count(*) FILTER (WHERE deaths IS NULL AND deaths_order >= 1)
                FROM quakes{where}""",
            params,
        ).fetchone()
        total_deaths, deadly, approx = totals if totals else (0, 0, 0)
        # Ties on magnitude go to the instrumental (USGS) record, then the earlier event.
        strongest = self._event_row(
            where, params, "magnitude DESC, (source = 'noaa'), time_ms, rid"
        )
        deadly_where = f"{where} AND {DEADLY_SQL}" if where else f" WHERE {DEADLY_SQL}"
        # Exact counts outrank orders of magnitude; an order-4 event ranks as ">1000".
        deadliest = self._event_row(
            deadly_where,
            params,
            "coalesce(deaths, CASE deaths_order WHEN 4 THEN 1001 WHEN 3 THEN 101 "
            "WHEN 2 THEN 51 ELSE 1 END) DESC, magnitude DESC, rid",
        )
        counts = [YearCount(year=y, count=c, deaths=int(d)) for y, c, d in per_year]
        return Summary(
            total=sum(c.count for c in counts),
            strongest=strongest,
            per_year=counts,
            total_deaths=int(total_deaths),
            deadly_events=int(deadly),
            approx_deadly_events=int(approx),
            deadliest=deadliest,
        )

    def meta(self, max_points: int, *, simulator_ready: bool = False) -> Meta:
        """Dataset bounds and per-source counts."""
        cur = self._cursor()
        row = cur.execute(
            f"""SELECT min(time_ms), max(time_ms), min(year), max(year),
                       min(magnitude), max(magnitude), min(depth_km), max(depth_km), count(*),
                       count(*) FILTER (WHERE {DEADLY_SQL})
                FROM quakes"""
        ).fetchone()
        assert row is not None
        t0, t1, y0, y1, m0, m1, d0, d1, total, deadly = row
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
            deadly_events=deadly,
            simulator_ready=simulator_ready,
            families_ready=self.families_info is not None,
        )

    # ------------------------------------------------------------------ simulator support

    def analogs(
        self,
        lat: float,
        lon: float,
        magnitude: float,
        *,
        radius_km: float = 300.0,
        magnitude_window: float = 0.75,
        limit: int = 6,
    ) -> AnalogSummary:
        """Past earthquakes near a point with a similar magnitude, most similar first."""
        bbox, params = _bbox_sql(lat, radius_km)
        params.update(lat=lat, lon=lon, m=magnitude, w=magnitude_window, r=radius_km)
        base = f"""
            SELECT rid, event_id, time_ms, year, latitude, longitude, depth_km, magnitude,
                   place, source, deaths, deaths_order, {_distance_sql()} AS distance_km
            FROM quakes
            WHERE {bbox} AND magnitude BETWEEN $m - $w AND $m + $w
        """
        cur = self._cursor()
        stats = cur.execute(
            f"""SELECT count(*), count(*) FILTER (WHERE {DEADLY_SQL}), max(deaths)
                FROM ({base}) WHERE distance_km <= $r""",
            params,
        ).fetchone()
        rows = cur.execute(
            f"""SELECT * FROM ({base}) WHERE distance_km <= $r
                ORDER BY abs(magnitude - $m) / $w + distance_km / $r, time_ms DESC
                LIMIT {int(limit)}""",
            params,
        ).fetchall()
        events = [
            Analog(
                rid=r[0],
                event_id=r[1],
                time=r[2],
                year=r[3],
                latitude=r[4],
                longitude=r[5],
                depth_km=_opt_float(r[6]),
                magnitude=round(float(r[7]), 2),
                place=r[8],
                source=r[9],
                deaths=_opt_int(r[10]),
                deaths_order=_opt_int(r[11]),
                deaths_label=deaths_label(_opt_int(r[10]), _opt_int(r[11])),
                distance_km=round(float(r[12]), 1),
            )
            for r in rows
        ]
        count, deadly, max_deaths = stats if stats else (0, 0, None)
        return AnalogSummary(
            radius_km=radius_km,
            magnitude_window=magnitude_window,
            count=int(count),
            deadly=int(deadly),
            max_deaths=_opt_int(max_deaths),
            events=events,
        )

    def recurrence(
        self,
        lat: float,
        lon: float,
        magnitude: float,
        *,
        radius_km: float = 200.0,
        b_value: float = 1.0,
        min_events: int = 5,
    ) -> Recurrence:
        """How often earthquakes at least this large occur within ``radius_km``.

        Uses instrumental (USGS) events from 1973 onward (or the catalog's first
        year if later), when global catalogs are roughly complete above M5. If
        fewer than ``min_events`` events reach the scenario magnitude, the rate
        is extrapolated from the M>=reference rate with a Gutenberg-Richter
        b-value of 1, the global average. This is a long-run average, not a
        forecast of when the next one will happen.
        """
        cur = self._cursor()
        span = cur.execute(
            "SELECT min(year), max(year), min(magnitude) FROM quakes WHERE source = 'usgs'"
        ).fetchone()
        if not span or span[0] is None:
            return Recurrence(
                radius_km=radius_km,
                magnitude=magnitude,
                start_year=0,
                end_year=0,
                reference_magnitude=5.0,
                reference_count=0,
                count_at_or_above=0,
                rate_per_year=None,
                return_period_years=None,
                probability_50yr=None,
                method="insufficient-data",
            )
        y0, y1, catalog_min = int(span[0]), int(span[1]), float(span[2])
        start = max(y0, 1973) if y1 >= 1983 else y0
        years = y1 - start + 1
        m_ref = max(5.0, math.ceil(catalog_min * 10 - 1e-6) / 10)
        bbox, params = _bbox_sql(lat, radius_km)
        params.update(lat=lat, lon=lon, r=radius_km, start=start, mref=m_ref, m=magnitude)
        row = cur.execute(
            f"""SELECT count(*) FILTER (WHERE magnitude >= $mref::FLOAT),
                       count(*) FILTER (WHERE magnitude >= $m::FLOAT)
                FROM quakes
                WHERE source = 'usgs' AND year >= $start AND {bbox}
                  AND {_distance_sql()} <= $r""",
            params,
        ).fetchone()
        n_ref, n_m = (int(row[0]), int(row[1])) if row else (0, 0)
        if n_m >= min_events and magnitude >= m_ref:
            rate, method = n_m / years, "empirical"
        elif n_ref > 0:
            rate = n_ref / years * 10 ** (-b_value * (magnitude - m_ref))
            method = "gutenberg-richter"
        else:
            rate, method = None, "insufficient-data"
        return Recurrence(
            radius_km=radius_km,
            magnitude=magnitude,
            start_year=start,
            end_year=y1,
            reference_magnitude=m_ref,
            reference_count=n_ref,
            count_at_or_above=n_m,
            rate_per_year=rate,
            return_period_years=(1 / rate) if rate else None,
            probability_50yr=(1 - math.exp(-50 * rate)) if rate else None,
            method=method,
        )

    def training_frame(self, *, min_magnitude: float, start_year: int) -> pa.Table:
        """Instrumental events used to train the fatality model (with death labels)."""
        return (
            self._cursor()
            .sql(
                """SELECT rid, year, latitude, longitude, coalesce(depth_km, 10) AS depth_km,
                          magnitude, deaths, deaths_order
                   FROM quakes
                   WHERE source = 'usgs' AND magnitude >= $m AND year >= $y""",
                params={"m": min_magnitude, "y": start_year},
            )
            .to_arrow_table()
        )

    # ------------------------------------------------------------------ families

    def _family_event(self, rid: int) -> FamilyEvent:
        row = (
            self._cursor()
            .execute(
                """SELECT rid, event_id, time_ms, latitude, longitude, depth_km, magnitude, place
                   FROM quakes WHERE rid = ?""",
                [rid],
            )
            .fetchone()
        )
        assert row is not None, rid
        return FamilyEvent(
            rid=row[0],
            event_id=row[1],
            time=row[2],
            latitude=row[3],
            longitude=row[4],
            depth_km=_opt_float(row[5]),
            magnitude=round(float(row[6]), 2),
            place=row[7],
        )

    def _threshold(self) -> float:
        if self.families_info is None:
            raise RuntimeError("families have not been built")
        return self.families_info.threshold

    def family(self, rid: int, *, max_members: int = MAX_FAMILY_MEMBERS) -> Family | None:
        """The family containing ``rid`` with its members, or ``None`` if ``rid`` does not exist."""
        threshold = self._threshold()
        cur = self._cursor()
        row = cur.execute(
            """SELECT role, cluster_id, mainshock_rid, parent_rid, nn_parent_rid,
                      log_eta, log_t, log_r
               FROM quakes WHERE rid = ?""",
            [rid],
        ).fetchone()
        if row is None:
            return None
        role, cluster_id, mainshock_rid, parent_rid, nn_rid, log_eta, log_t, log_r = row
        classified = role != fam.ROLES["unclassified"] and cluster_id is not None
        where, params = ("cluster_id = ?", [cluster_id]) if classified else ("rid = ?", [rid])
        cols = cur.execute(
            f"""SELECT rid, time_ms, latitude, longitude, depth_km, magnitude,
                       coalesce(parent_rid::BIGINT, -1) AS parent, coalesce(generation, 0) AS gen,
                       role
                FROM quakes WHERE {where} ORDER BY time_ms, rid""",
            params,
        ).fetchnumpy()
        rids = np.asarray(cols["rid"], dtype=np.int64)
        parents = np.asarray(cols["parent"], dtype=np.int64)
        mags = np.asarray(cols["magnitude"], dtype=float)
        gens = np.asarray(cols["gen"], dtype=np.int64)
        roles = np.asarray(cols["role"], dtype=np.int64)
        keep_rids = {rid, int(cluster_id)} if classified else {rid}
        if classified and mainshock_rid is not None:
            keep_rids.add(int(mainshock_rid))
        keep, display_parent = fam.trim_members(rids, parents, mags, keep_rids, max_members)

        generations = [
            GenerationCount(
                generation=int(g),
                count=int((gens == g).sum()),
                max_magnitude=round(float(mags[gens == g].max()), 2),
            )
            for g in np.unique(gens)
        ]
        depth = np.asarray(cols["depth_km"], dtype=float)
        times = np.asarray(cols["time_ms"], dtype=np.int64)
        members = FamilyMembers(
            rid=rids[keep].tolist(),
            time=times[keep].tolist(),
            latitude=np.asarray(cols["latitude"], dtype=float)[keep].tolist(),
            longitude=np.asarray(cols["longitude"], dtype=float)[keep].tolist(),
            depth_km=[None if math.isnan(d) else round(d, 2) for d in depth[keep].tolist()],
            magnitude=[round(m, 2) for m in mags[keep].tolist()],
            parent_rid=[None if p < 0 else p for p in display_parent[keep].tolist()],
            generation=gens[keep].tolist(),
            role=[fam.ROLE_NAMES[int(r)] for r in roles[keep]],
        )
        mainshock = self._family_event(int(mainshock_rid)) if classified else None
        neighbour = None
        if classified:
            neighbour = NearestNeighbour(
                rid=nn_rid,
                log_eta=_rounded(log_eta),
                log_t=_rounded(log_t),
                log_r=_rounded(log_r),
                linked=parent_rid is not None,
                threshold=threshold,
            )
        n_after = int((roles == fam.ROLES["aftershock"]).sum())
        return Family(
            rid=rid,
            role=fam.ROLE_NAMES[int(role)],
            cluster_id=int(cluster_id) if classified else None,
            size=len(rids),
            foreshocks=int((roles == fam.ROLES["foreshock"]).sum()),
            aftershocks=n_after,
            generations=generations,
            mainshock=mainshock,
            root_rid=int(cluster_id) if classified else None,
            start_time=int(times.min()) if len(times) else None,
            end_time=int(times.max()) if len(times) else None,
            neighbour=neighbour,
            members=members,
            truncated=bool(not keep.all()),
            forecast_eligible=bool(
                mainshock is not None
                and mainshock.magnitude >= FORECAST_MIN_MAGNITUDE
                and n_after > 0
            ),
        )

    def family_stats(self) -> FamilyStats:
        """Method parameters, role counts, proximity histograms and the largest families."""
        if self._family_stats is not None:
            return self._family_stats
        info = self.families_info
        if info is None:
            raise RuntimeError("families have not been built")
        cur = self._cursor()
        counts = dict(
            cur.execute("SELECT role, count(*) FROM quakes WHERE role > 0 GROUP BY role").fetchall()
        )
        roles = {name: int(counts.get(code, 0)) for name, code in fam.ROLES.items() if code > 0}
        analysed = sum(roles.values())
        nn = cur.execute(
            "SELECT log_eta, log_t, log_r FROM quakes WHERE role > 0 AND log_eta IS NOT NULL"
        ).fetchnumpy()
        log_eta = np.asarray(nn["log_eta"], dtype=float)
        log_t = np.asarray(nn["log_t"], dtype=float)
        log_r = np.asarray(nn["log_r"], dtype=float)

        def edges(values: np.ndarray, step: float, hi: float | None = None) -> np.ndarray:
            if len(values) == 0:
                return np.array([0.0, step])
            lo_e = math.floor(np.percentile(values, 0.1) / step) * step
            hi_e = hi if hi is not None else math.ceil(np.percentile(values, 99.9) / step) * step
            return np.arange(lo_e, max(hi_e, lo_e + step) + step / 2, step)

        eta_edges = edges(log_eta, 0.25, info.log_eta_cap)
        eta_counts, _ = np.histogram(np.clip(log_eta, eta_edges[0], eta_edges[-1]), eta_edges)
        x_edges, y_edges = edges(log_t, 0.25), edges(log_r, 0.25)
        density, _, _ = np.histogram2d(
            np.clip(log_t, x_edges[0], x_edges[-1]),
            np.clip(log_r, y_edges[0], y_edges[-1]),
            [x_edges, y_edges],
        )
        largest_rows = cur.execute(
            f"""SELECT mainshock_rid, count(*) AS size,
                       count(*) FILTER (WHERE role = {fam.ROLES["foreshock"]}),
                       count(*) FILTER (WHERE role = {fam.ROLES["aftershock"]})
                FROM quakes WHERE role >= {fam.ROLES["mainshock"]}
                GROUP BY mainshock_rid ORDER BY size DESC, mainshock_rid LIMIT 8"""
        ).fetchall()
        dependent = roles["foreshock"] + roles["aftershock"]
        self._family_stats = FamilyStats(
            threshold=info.threshold,
            threshold_method=info.threshold_method,
            b_value=info.b_value,
            fractal_dimension=info.fractal_dimension,
            q=info.q,
            log_eta_cap=info.log_eta_cap,
            r_min_km=info.r_min_km,
            min_magnitude=info.min_magnitude,
            built_at=info.built_at,
            analysed=analysed,
            roles=roles,
            families=roles["mainshock"],
            clustered_fraction=round(dependent / analysed, 4) if analysed else 0.0,
            gmm=info.gmm,
            eta_histogram=Histogram(
                edges=[round(float(e), 3) for e in eta_edges], counts=eta_counts.tolist()
            ),
            density=Histogram2D(
                x_edges=[round(float(e), 3) for e in x_edges],
                y_edges=[round(float(e), 3) for e in y_edges],
                counts=density.astype(int).tolist(),
            ),
            largest=[
                LargestFamily(
                    mainshock=self._family_event(int(r[0])),
                    size=int(r[1]),
                    foreshocks=int(r[2]),
                    aftershocks=int(r[3]),
                )
                for r in largest_rows
            ],
        )
        return self._family_stats

    def aftershock_forecast(
        self, rid: int, *, fit_days: float, horizon_days: float
    ) -> AftershockForecast | None:
        """Omori-Utsu fit to the first ``fit_days`` of the family's aftershocks, compared with
        what happened up to ``horizon_days``. ``None`` if ``rid`` does not exist."""
        self._threshold()
        cur = self._cursor()
        row = cur.execute(
            "SELECT role, cluster_id, mainshock_rid FROM quakes WHERE rid = ?", [rid]
        ).fetchone()
        if row is None:
            return None
        role, cluster_id, mainshock_rid = row
        classified = role != fam.ROLES["unclassified"] and mainshock_rid is not None
        mainshock = self._family_event(int(mainshock_rid) if classified else rid)
        floor_row = cur.execute(
            "SELECT min(magnitude), max(time_ms) FROM quakes WHERE role > 0"
        ).fetchone()
        floor = round(float(floor_row[0]), 2) if floor_row and floor_row[0] is not None else 0.0
        catalog_end = (
            int(floor_row[1]) if floor_row and floor_row[1] is not None else mainshock.time
        )
        if not classified or mainshock.magnitude < FORECAST_MIN_MAGNITUDE:
            reason = (
                "Historical records are not grouped into families."
                if not classified
                else f"Forecasts are offered for mainshocks of M {FORECAST_MIN_MAGNITUDE} and up."
            )
            return aftershocks.not_eligible(mainshock, fit_days, horizon_days, floor, reason)
        times = cur.execute(
            f"""SELECT time_ms FROM quakes
                WHERE cluster_id = ? AND role = {fam.ROLES["aftershock"]} ORDER BY time_ms""",
            [cluster_id],
        ).fetchnumpy()["time_ms"]
        days = (np.asarray(times, dtype=np.int64) - mainshock.time) / MS_PER_DAY
        available = (catalog_end - mainshock.time) / MS_PER_DAY
        return aftershocks.forecast(
            mainshock,
            days,
            fit_days=fit_days,
            horizon_days=horizon_days,
            available_days=available,
            min_magnitude=floor,
        )

    def close(self) -> None:
        self._con.close()
