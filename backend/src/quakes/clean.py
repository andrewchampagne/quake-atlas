"""Normalise raw USGS and NOAA downloads into a single Parquet file.

Output schema (``data/processed/earthquakes.parquet``):

==========  =====================  ==========================================
column      type                   notes
==========  =====================  ==========================================
rid         uint32                 stable row id, assigned in time order
event_id    string                 USGS id, or ``noaa-<id>``
time        timestamp[ms, UTC]     may be BCE
year        int32                  astronomical numbering (1 BCE = 0)
latitude    float64
longitude   float64                wrapped to [-180, 180]
depth_km    float32                nullable (NOAA often has no depth)
magnitude   float32
mag_type    string                 nullable
place       string                 nullable
source      string                 ``usgs`` | ``noaa``
deaths      int32                  nullable; total deaths (incl. tsunami etc.)
deaths_order int8                  nullable; NOAA order: 0 none, 1 = 1-50,
                                   2 = 51-100, 3 = 101-1000, 4 = over 1000
==========  =====================  ==========================================

Death tolls come from NOAA. Records before 1900 are events in their own right;
later NOAA records are matched to the USGS event they describe (close in time
and space) and only contribute ``deaths`` / ``deaths_order``. USGS events with
no matching NOAA record have null deaths. Missing reports are unknown, never zero.

Internally time is carried as ``time_ms`` (int64 epoch milliseconds) because
neither :mod:`datetime` nor nanosecond pandas timestamps can hold BCE dates.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from quakes import timeutil
from quakes.config import SOURCE_CUTOFF_MS

log = logging.getLogger(__name__)

COLUMNS = [
    "event_id",
    "time_ms",
    "latitude",
    "longitude",
    "depth_km",
    "magnitude",
    "mag_type",
    "place",
    "source",
    "deaths",
    "deaths_order",
]
KEY_FIELDS = ["time_ms", "latitude", "longitude", "magnitude"]

PARQUET_SCHEMA = pa.schema(
    [
        pa.field("rid", pa.uint32(), nullable=False),
        pa.field("event_id", pa.string(), nullable=False),
        pa.field("time", pa.timestamp("ms", tz="UTC"), nullable=False),
        pa.field("year", pa.int32(), nullable=False),
        pa.field("latitude", pa.float64(), nullable=False),
        pa.field("longitude", pa.float64(), nullable=False),
        pa.field("depth_km", pa.float32()),
        pa.field("magnitude", pa.float32(), nullable=False),
        pa.field("mag_type", pa.string()),
        pa.field("place", pa.string()),
        pa.field("source", pa.string(), nullable=False),
        pa.field("deaths", pa.int32()),
        pa.field("deaths_order", pa.int8()),
    ]
)

_USGS_USECOLS = {"time", "latitude", "longitude", "depth", "mag", "magType", "id", "place", "type"}
#: NOAA magnitude columns in order of preference when labelling ``mag_type``.
_NOAA_MAG_COLUMNS = {
    "eqMagMw": "Mw",
    "eqMagMs": "Ms",
    "eqMagMb": "mb",
    "eqMagMl": "ML",
    "eqMagMfa": "Mfa",
    "eqMagUnk": "unknown",
}


@dataclass
class CleanReport:
    """Row counts at each stage of :func:`run_clean`."""

    usgs_raw: int
    noaa_raw: int
    after_validation: int
    after_dedup: int
    output_path: Path
    impacts: int = 0
    impacts_matched: int = 0
    deadly_events: int = 0


def _empty() -> pd.DataFrame:
    return pd.DataFrame({c: pd.Series(dtype="object") for c in COLUMNS})


def _numeric(df: pd.DataFrame, column: str) -> pd.Series:
    """Column as float, or all-NaN if the column is absent."""
    if column not in df:
        return pd.Series(np.nan, index=df.index, dtype="float64")
    return pd.to_numeric(df[column], errors="coerce")


def _string(df: pd.DataFrame, column: str) -> pd.Series:
    if column not in df:
        return pd.Series(pd.NA, index=df.index, dtype="string")
    return df[column].astype("string").str.strip().replace("", pd.NA)


# --------------------------------------------------------------------------- readers


def read_usgs_raw(raw_dir: Path) -> pd.DataFrame:
    """Concatenate all USGS CSV chunks, oldest download first."""
    files = sorted((raw_dir / "usgs").rglob("*.csv"), key=lambda p: p.stat().st_mtime)
    frames = [
        pd.read_csv(
            f,
            usecols=lambda c: c in _USGS_USECOLS,
            dtype={"id": "string", "place": "string", "magType": "string", "type": "string"},
        )
        for f in files
        if f.stat().st_size > 0
    ]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def read_noaa_raw(raw_dir: Path) -> pd.DataFrame:
    """Concatenate the ``items`` of all NOAA JSON pages."""
    items: list[dict[str, object]] = []
    for f in sorted((raw_dir / "noaa").rglob("page_*.json")):
        items.extend(json.loads(f.read_text(encoding="utf-8")).get("items", []))
    return pd.DataFrame(items)


# --------------------------------------------------------------------------- normalisers


def normalize_usgs(raw: pd.DataFrame) -> pd.DataFrame:
    """Map USGS CSV columns onto the common schema."""
    if raw.empty:
        return _empty()
    df = raw
    if "type" in df:
        df = df[df["type"].fillna("earthquake") == "earthquake"]
    t = pd.to_datetime(df["time"], utc=True, errors="coerce", format="ISO8601")
    time_ms = (t - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(1, "ms")
    return pd.DataFrame(
        {
            "event_id": _string(df, "id"),
            "time_ms": time_ms.astype("Int64"),
            "latitude": _numeric(df, "latitude"),
            "longitude": _numeric(df, "longitude"),
            "depth_km": _numeric(df, "depth"),
            "magnitude": _numeric(df, "mag"),
            "mag_type": _string(df, "magType"),
            "place": _string(df, "place"),
            "source": "usgs",
            "deaths": pd.Series(pd.NA, index=df.index, dtype="Int64"),
            "deaths_order": pd.Series(pd.NA, index=df.index, dtype="Int64"),
        }
    )


def _noaa_place(df: pd.DataFrame) -> pd.Series:
    """``"JAPAN:  SANRIKU"`` -> ``"Japan: Sanriku"``."""
    place = _string(df, "locationName")
    return (
        place.str.replace(r"\s+", " ", regex=True)
        .str.replace(r"\s*,\s*", ", ", regex=True)
        .str.title()
    )


def _noaa_mag_type(df: pd.DataFrame, magnitude: pd.Series) -> pd.Series:
    """Label each primary magnitude with the first scale column that matches it."""
    mag_type = pd.Series(pd.NA, index=df.index, dtype="string")
    for column, label in _NOAA_MAG_COLUMNS.items():
        values = _numeric(df, column)
        match = mag_type.isna() & values.notna() & np.isclose(values, magnitude)
        mag_type = mag_type.mask(match, label)
    return mag_type


def deaths_to_order(deaths: pd.Series) -> pd.Series:
    """NOAA's ordinal death scale for a count: 0, 1-50, 51-100, 101-1000, >1000."""
    order = pd.cut(deaths, bins=[-1, 0, 50, 100, 1000, np.inf], labels=False)
    return pd.Series(order, index=deaths.index).astype("Int64")


def _first_present(df: pd.DataFrame, *columns: str) -> pd.Series:
    """Element-wise first non-null value among ``columns``."""
    out = _numeric(df, columns[0])
    for column in columns[1:]:
        out = out.fillna(_numeric(df, column))
    return out


def noaa_to_astronomical(year: pd.Series) -> pd.Series:
    """NOAA counts BCE years as negative with no year zero (-1 = 1 BCE).

    Astronomical numbering has a year zero (0 = 1 BCE), so shift negatives by one.
    """
    return year.where(year >= 0, year + 1)


def normalize_noaa(raw: pd.DataFrame) -> pd.DataFrame:
    """Map NOAA Hazel JSON fields onto the common schema.

    Missing month/day/time parts default to January 1st, 00:00 UTC. Death tolls
    prefer the totals (which include tsunami and other secondary deaths). The
    extra boolean column ``time_known`` records whether the hour was given; it
    is used for matching and is not written to Parquet.
    """
    if raw.empty:
        return _empty()
    df = raw
    year = noaa_to_astronomical(_numeric(df, "year"))
    valid_year = year.notna()
    month = _numeric(df, "month").fillna(1).clip(1, 12)
    day = _numeric(df, "day").fillna(1).clip(1, 31)
    hour = _numeric(df, "hour").fillna(0).clip(0, 23)
    minute = _numeric(df, "minute").fillna(0).clip(0, 59)
    second = _numeric(df, "second").fillna(0).clip(0, 59.999)
    time_ms = pd.Series(
        timeutil.epoch_ms(year.fillna(0), month, day, hour, minute, second),
        index=df.index,
        dtype="Int64",
    ).where(valid_year)
    magnitude = _numeric(df, "eqMagnitude")
    deaths = _first_present(df, "deathsTotal", "deaths").round().astype("Int64")
    order = _first_present(df, "deathsAmountOrderTotal", "deathsAmountOrder").astype("Int64")
    order = order.fillna(deaths_to_order(deaths.astype("float64")))
    return pd.DataFrame(
        {
            "event_id": "noaa-" + _numeric(df, "id").astype("Int64").astype("string"),
            "time_ms": time_ms,
            "latitude": _numeric(df, "latitude"),
            "longitude": _numeric(df, "longitude"),
            "depth_km": _numeric(df, "eqDepth"),
            "magnitude": magnitude,
            "mag_type": _noaa_mag_type(df, magnitude),
            "place": _noaa_place(df),
            "source": "noaa",
            "deaths": deaths,
            "deaths_order": order,
            "time_known": _numeric(df, "hour").notna(),
        }
    )


# --------------------------------------------------------------------------- cleaning steps


def drop_invalid(df: pd.DataFrame) -> pd.DataFrame:
    """Drop rows missing key fields or with impossible coordinates; wrap longitudes."""
    df = df.dropna(subset=[*KEY_FIELDS, "event_id"]).copy()
    lon = df["longitude"]
    df["longitude"] = lon.where(lon <= 180, lon - 360)
    ok = df["latitude"].between(-90, 90) & df["longitude"].between(-180, 180)
    ok &= df["magnitude"].between(-3, 10.5)
    return df[ok]


def _haversine_km(
    lat1: np.ndarray, lon1: np.ndarray, lat2: np.ndarray, lon2: np.ndarray
) -> np.ndarray:
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlmb = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def drop_cross_source_duplicates(
    df: pd.DataFrame, time_tol_ms: int = 60_000, max_km: float = 100.0
) -> pd.DataFrame:
    """Remove NOAA rows that duplicate a USGS event (close in time and space).

    USGS is preferred because its locations and magnitudes are instrumental.
    """
    noaa = df[df["source"] == "noaa"]
    usgs = df[df["source"] == "usgs"]
    if noaa.empty or usgs.empty:
        return df
    left = noaa[["time_ms", "latitude", "longitude"]].astype({"time_ms": "int64"}).reset_index()
    right = usgs[["time_ms", "latitude", "longitude"]].astype({"time_ms": "int64"})
    matched = pd.merge_asof(
        left.sort_values("time_ms"),
        right.sort_values("time_ms"),
        on="time_ms",
        direction="nearest",
        tolerance=time_tol_ms,
        suffixes=("", "_usgs"),
    ).dropna(subset=["latitude_usgs"])
    dist = _haversine_km(
        matched["latitude"].to_numpy(),
        matched["longitude"].to_numpy(),
        matched["latitude_usgs"].to_numpy(),
        matched["longitude_usgs"].to_numpy(),
    )
    duplicates = matched.loc[dist <= max_km, "index"]
    return df.drop(index=duplicates)


def deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    """Drop repeated events.

    1. Same ``event_id`` (overlapping download chunks): keep the last, i.e. the
       most recently downloaded copy.
    2. Identical time, location and magnitude under different ids.
    3. NOAA events that duplicate a USGS event.
    """
    df = df.drop_duplicates("event_id", keep="last")
    df = df.drop_duplicates(["time_ms", "latitude", "longitude", "magnitude"], keep="first")
    return drop_cross_source_duplicates(df)


def is_deadly(df: pd.DataFrame) -> pd.Series:
    """Rows with at least one recorded death (exact count or NOAA order >= 1)."""
    return (df["deaths"].fillna(0) >= 1) | (df["deaths_order"].fillna(0) >= 1)


def attach_impacts(
    events: pd.DataFrame,
    impacts: pd.DataFrame,
    *,
    timed_tol_ms: int = 5 * 60_000,
    timed_km: float = 150.0,
    dated_km: float = 250.0,
    max_dmag: float = 1.0,
) -> tuple[pd.DataFrame, int]:
    """Copy NOAA death tolls onto the USGS events they describe.

    For each NOAA record that reports deaths, candidate USGS events are those
    within ``timed_tol_ms`` (records with a clock time) or within the same day,
    widened to -12 h / +36 h for possibly-local dates (records with a date
    only), that lie within ``timed_km`` / ``dated_km`` and within ``max_dmag``
    magnitude units. The best candidate by a combined distance-time-magnitude
    score wins. Returns the updated events and the number of records matched.
    """
    out = events.copy()
    if impacts.empty or out.empty:
        return out, 0
    reports = impacts[impacts["deaths"].notna() | impacts["deaths_order"].notna()].dropna(
        subset=["time_ms", "latitude", "longitude"]
    )
    usgs = out[out["source"] == "usgs"].sort_values("time_ms")
    if reports.empty or usgs.empty:
        return out, 0
    t = usgs["time_ms"].to_numpy(np.int64)
    lat = usgs["latitude"].to_numpy(float)
    lon = usgs["longitude"].to_numpy(float)
    mag = usgs["magnitude"].to_numpy(float)
    index = usgs.index.to_numpy()

    best: dict[object, tuple[float, int | None, int | None]] = {}
    matched = 0
    for row in reports.itertuples(index=False):
        t0 = int(row.time_ms)
        if bool(row.time_known):
            lo_t, hi_t, max_km, half = t0 - timed_tol_ms, t0 + timed_tol_ms, timed_km, timed_tol_ms
        else:
            lo_t, hi_t = t0 - 12 * 3_600_000, t0 + 36 * 3_600_000
            max_km, half = dated_km, 86_400_000
        lo, hi = np.searchsorted(t, lo_t, "left"), np.searchsorted(t, hi_t, "right")
        if lo == hi:
            continue
        n = hi - lo
        dist = _haversine_km(
            np.full(n, row.latitude), np.full(n, row.longitude), lat[lo:hi], lon[lo:hi]
        )
        has_mag = pd.notna(row.magnitude)
        dmag = np.abs(mag[lo:hi] - row.magnitude) if has_mag else np.zeros(n)
        ok = (dist <= max_km) & (dmag <= max_dmag)
        if not ok.any():
            continue
        score = dist / max_km + np.abs(t[lo:hi] - t0) / half + dmag
        score[~ok] = np.inf
        target = index[lo + int(np.argmin(score))]
        deaths = None if pd.isna(row.deaths) else int(row.deaths)
        order = None if pd.isna(row.deaths_order) else int(row.deaths_order)
        # Prefer exact counts; among them the larger toll (two records for one event).
        rank = float(deaths) if deaths is not None else float(order or 0) - 10.0
        if target not in best or rank > best[target][0]:
            best[target] = (rank, deaths, order)
        matched += 1

    for target, (_rank, deaths, order) in best.items():
        out.loc[target, "deaths"] = deaths if deaths is not None else pd.NA
        out.loc[target, "deaths_order"] = order if order is not None else pd.NA
    return out, matched


def split_noaa(
    noaa: pd.DataFrame, cutoff_ms: int = SOURCE_CUTOFF_MS
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """NOAA records before the cutoff (map events) and from it onwards (death reports)."""
    if noaa.empty:
        return noaa, noaa
    noaa = noaa.drop_duplicates("event_id", keep="last")
    before = noaa["time_ms"] < cutoff_ms
    return noaa[before], noaa[~before & noaa["time_ms"].notna()]


def combine(
    usgs: pd.DataFrame, noaa: pd.DataFrame, cutoff_ms: int = SOURCE_CUTOFF_MS
) -> pd.DataFrame:
    """Merge normalised sources: NOAA before ``cutoff_ms``, USGS from it onwards."""
    usgs = usgs[usgs["time_ms"] >= cutoff_ms] if not usgs.empty else usgs
    noaa = noaa[noaa["time_ms"] < cutoff_ms] if not noaa.empty else noaa
    frames = [f for f in (usgs, noaa) if not f.empty]
    return pd.concat(frames, ignore_index=True) if frames else _empty()


def finalize(df: pd.DataFrame) -> pd.DataFrame:
    """Sort by time, assign ``rid`` and ``year`` and fix dtypes."""
    df = df.astype({"time_ms": "int64"}).sort_values(["time_ms", "event_id"], kind="mergesort")
    df = df.reset_index(drop=True)
    df.insert(0, "rid", np.arange(len(df), dtype=np.uint32))
    df["year"] = timeutil.year_of(df["time_ms"].to_numpy()).astype(np.int32)
    return df


def to_arrow(df: pd.DataFrame) -> pa.Table:
    """Convert a finalised frame to an Arrow table with :data:`PARQUET_SCHEMA`."""
    time = pa.array(df["time_ms"].to_numpy(np.int64), type=pa.int64())
    columns = {
        "rid": pa.array(df["rid"].to_numpy(np.uint32), type=pa.uint32()),
        "event_id": pa.array(df["event_id"].astype(str), type=pa.string()),
        "time": time.cast(pa.timestamp("ms", tz="UTC")),
        "year": pa.array(df["year"].to_numpy(np.int32), type=pa.int32()),
        "latitude": pa.array(df["latitude"].to_numpy(np.float64)),
        "longitude": pa.array(df["longitude"].to_numpy(np.float64)),
        "depth_km": pa.array(df["depth_km"].astype("float32"), type=pa.float32(), from_pandas=True),
        "magnitude": pa.array(df["magnitude"].to_numpy(np.float32)),
        "mag_type": pa.array(df["mag_type"], type=pa.string(), from_pandas=True),
        "place": pa.array(df["place"], type=pa.string(), from_pandas=True),
        "source": pa.array(df["source"].astype(str), type=pa.string()),
        "deaths": pa.array(df["deaths"].astype("Int64"), type=pa.int32(), from_pandas=True),
        "deaths_order": pa.array(
            df["deaths_order"].astype("Int64"), type=pa.int8(), from_pandas=True
        ),
    }
    return pa.Table.from_pydict(columns, schema=PARQUET_SCHEMA)


def write_parquet(table: pa.Table, path: Path) -> None:
    """Write atomically with zstd compression."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)


def clean_frames(usgs_raw: pd.DataFrame, noaa_raw: pd.DataFrame) -> pd.DataFrame:
    """Full in-memory pipeline from raw frames to a finalised frame."""
    noaa_events, impacts = split_noaa(normalize_noaa(noaa_raw))
    df = deduplicate(drop_invalid(combine(normalize_usgs(usgs_raw), noaa_events)))
    return finalize(attach_impacts(df, impacts)[0])


def run_clean(raw_dir: Path, out_path: Path) -> CleanReport:
    """Read everything under ``raw_dir`` and write the cleaned Parquet file."""
    usgs_raw = read_usgs_raw(raw_dir)
    noaa_raw = read_noaa_raw(raw_dir)
    if usgs_raw.empty and noaa_raw.empty:
        raise FileNotFoundError(f"No raw data under {raw_dir}; run an ingest command first.")
    noaa_events, impacts = split_noaa(normalize_noaa(noaa_raw))
    combined = combine(normalize_usgs(usgs_raw), noaa_events)
    valid = drop_invalid(combined)
    deduped = deduplicate(valid)
    with_deaths, matched = attach_impacts(deduped, impacts)
    final = finalize(with_deaths)
    write_parquet(to_arrow(final), out_path)
    deadly_reports = int(is_deadly(impacts).sum()) if not impacts.empty else 0
    report = CleanReport(
        len(usgs_raw),
        len(noaa_raw),
        len(valid),
        len(final),
        out_path,
        impacts=deadly_reports,
        impacts_matched=matched,
        deadly_events=int(is_deadly(final).sum()),
    )
    log.info(
        "Cleaned %d USGS + %d NOAA rows -> %d valid -> %d unique, written to %s",
        report.usgs_raw,
        report.noaa_raw,
        report.after_validation,
        report.after_dedup,
        out_path,
    )
    log.info(
        "Deaths: matched %d of %d post-1900 NOAA death reports to USGS events (unmatched ones "
        "are usually below the downloaded magnitude floor or outside its years); "
        "%d events have recorded deaths",
        matched,
        deadly_reports,
        report.deadly_events,
    )
    return report
