"""Earthquake families: nearest-neighbour clustering after Zaliapin & Ben-Zion (2013).

For an event ``j`` and an earlier event ``i`` the space-time-magnitude proximity is::

    eta_ij = t_ij * r_ij**d_f * 10**(-b * m_i)

with ``t_ij`` in years, ``r_ij`` the epicentral distance in km and ``m_i`` the
earlier event's magnitude. It splits into rescaled time and distance::

    T_ij = t_ij * 10**(-q * b * m_i)      R_ij = r_ij**d_f * 10**(-(1 - q) * b * m_i)

so ``eta = T * R``. The earlier event with the smallest ``eta`` is the event's
nearest neighbour, its candidate *parent*. ``log10(eta)`` is bimodal: clustered
events (foreshocks and aftershocks) sit orders of magnitude below independent
"background" events. A two-component Gaussian mixture places the threshold
between the modes. Links below it are kept and join events into trees
(families); every other event starts a family of its own. The largest event of
a family is its mainshock, earlier members are foreshocks, later ones aftershocks.

Parameters ``b = 1``, ``d_f = 1.6`` and ``q = 0.5`` follow Zaliapin & Ben-Zion
(2013), "Earthquake clusters in southern California I: Identification and
stability", JGR Solid Earth 118, 2847-2864. Distances are floored at 1 km
(roughly the location precision of a global catalog) and times at 1 second.

Only USGS (instrumental) events are analysed. NOAA's historical records are too
sparse and their times and locations too uncertain.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pyarrow as pa
import pyarrow.parquet as pq
from sklearn.mixture import GaussianMixture
from sklearn.neighbors import KDTree

from quakes.clean import write_parquet

log = logging.getLogger(__name__)

FloatArray = npt.NDArray[np.float64]
IntArray = npt.NDArray[np.int64]

EARTH_RADIUS_KM = 6371.0
MS_PER_YEAR = 365.25 * 86_400_000
#: Zaliapin & Ben-Zion (2013) parameters.
B_VALUE = 1.0
FRACTAL_DIMENSION = 1.6
Q_SPLIT = 0.5
R_MIN_KM = 1.0
T_MIN_YEARS = 1.0 / (365.25 * 86_400)
#: Pairs are evaluated exactly whenever log10(eta) could fall below this cap.
#: It sits well above the background mode of global catalogs (about -4), so every
#: link that could matter is found; events whose nearest neighbour is farther are
#: background either way.
LOG_ETA_CAP = -1.5
#: Used when the proximities are not clearly bimodal (tiny or unusual catalogs).
DEFAULT_LOG_THRESHOLD = -5.0

#: ``role`` codes stored with each event (0 = not analysed, e.g. NOAA records).
ROLES: dict[str, int] = {
    "unclassified": 0,
    "single": 1,
    "mainshock": 2,
    "foreshock": 3,
    "aftershock": 4,
}
ROLE_NAMES = {code: name for name, code in ROLES.items()}
#: Roles removed by the "declustered" filter.
DEPENDENT_ROLES = (ROLES["foreshock"], ROLES["aftershock"])

METADATA_KEY = b"quakes.families"
_PAIR_CHUNK = 4_000_000
_TIME_FIRST_MAX = 32


@dataclass(frozen=True)
class NearestNeighbours:
    """Per-event nearest earlier neighbour. ``parent`` is -1 when none is closer than the cap."""

    parent: IntArray
    log_eta: FloatArray
    log_t: FloatArray
    log_r: FloatArray
    pairs_evaluated: int


@dataclass(frozen=True)
class Threshold:
    log_eta: float
    method: str
    means: tuple[float, ...] = ()
    sds: tuple[float, ...] = ()
    weights: tuple[float, ...] = ()


@dataclass(frozen=True)
class Assignment:
    """Family structure for events in time order (indices, not rids)."""

    parent: IntArray
    root: IntArray
    generation: IntArray
    mainshock: IntArray
    size: IntArray
    role: npt.NDArray[np.uint8]


@dataclass
class FamiliesInfo:
    """Build parameters and totals, stored in the Parquet schema metadata."""

    threshold: float
    threshold_method: str
    b_value: float
    fractal_dimension: float
    q: float
    log_eta_cap: float
    r_min_km: float
    min_magnitude: float | None
    analysed: int
    censored: int
    pairs_evaluated: int
    built_at: str
    gmm: dict[str, list[float]] = field(default_factory=dict)

    def to_json(self) -> bytes:
        return json.dumps(asdict(self)).encode()

    @classmethod
    def from_json(cls, raw: bytes) -> FamiliesInfo:
        return cls(**json.loads(raw))


# --------------------------------------------------------------------------- search


def unit_vectors(lat_deg: npt.ArrayLike, lon_deg: npt.ArrayLike) -> FloatArray:
    lat = np.radians(np.asarray(lat_deg, dtype=float))
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))


def _chord(radius_km: float) -> float:
    """Straight-line distance between unit-sphere points ``radius_km`` apart on the surface."""
    return 2.0 * math.sin(min(radius_km / EARTH_RADIUS_KM, math.pi) / 2.0)


def _shell_edges(r_min_km: float) -> list[tuple[float, float]]:
    """``(inner, outer)`` radii doubling from ``2 * r_min`` until they cover the globe."""
    half_globe = math.pi * EARTH_RADIUS_KM
    edges, inner, outer = [], 0.0, 2.0 * r_min_km
    while True:
        edges.append((inner, outer))
        if outer >= half_globe:
            return edges
        inner, outer = outer, outer * 2.0


def nearest_neighbours(
    t_years: npt.ArrayLike,
    lat: npt.ArrayLike,
    lon: npt.ArrayLike,
    magnitude: npt.ArrayLike,
    *,
    b: float = B_VALUE,
    df: float = FRACTAL_DIMENSION,
    q: float = Q_SPLIT,
    log_cap: float = LOG_ETA_CAP,
    r_min_km: float = R_MIN_KM,
    t_min_years: float = T_MIN_YEARS,
) -> NearestNeighbours:
    """Nearest earlier neighbour of every event. Events must be sorted by time.

    Exact for every event whose nearest-neighbour proximity is below ``log_cap``
    (the others get ``parent = -1`` and NaN components). A pair can only reach
    ``eta < cap`` if ``t * r**df < K_i = cap * 10**(b * m_i)``, a hyperbola in
    time and distance. It is covered by distance shells ``[r_k, 2 r_k)``, each
    with the time window ``K_i / r_k**df``. Within a shell, candidates come from
    whichever is smaller: the events inside the time window, or the events
    inside the shell's outer radius (found with a KD-tree).
    """
    t = np.asarray(t_years, dtype=float)
    m = np.asarray(magnitude, dtype=float)
    n = len(t)
    if n and np.any(np.diff(t) < 0):
        raise ValueError("events must be sorted by time")
    xyz = unit_vectors(lat, lon)
    best = np.full(n, np.inf)
    parent = np.full(n, -1, dtype=np.int64)
    pairs = 0

    def evaluate(ii: IntArray, jj: IntArray, log_r_inner: float) -> None:
        nonlocal pairs
        if len(ii) == 0:
            return
        pairs += len(ii)
        dt = np.maximum(t[jj] - t[ii], t_min_years)
        # Pairs closer than this shell were handled by an inner shell, so the shell's
        # inner radius bounds eta from below. Skip pairs that cannot beat the child's
        # current best (or the cap) before computing distances.
        bound = np.log10(dt) + df * log_r_inner - b * m[ii]
        useful = bound <= np.minimum(best[jj], log_cap)
        if not useful.all():
            ii, jj, dt = ii[useful], jj[useful], dt[useful]
            if len(ii) == 0:
                return
        chord = np.linalg.norm(xyz[jj] - xyz[ii], axis=1)
        r = np.maximum(2.0 * EARTH_RADIUS_KM * np.arcsin(np.minimum(chord / 2.0, 1.0)), r_min_km)
        le = np.log10(dt) + df * np.log10(r) - b * m[ii]
        # Per child: smallest eta, ties to the earliest parent (as a brute-force argmin would).
        order = np.lexsort((ii, le, jj))
        js, ls, is_ = jj[order], le[order], ii[order]
        first = np.ones(len(js), dtype=bool)
        first[1:] = js[1:] != js[:-1]
        js, ls, is_ = js[first], ls[first], is_[first]
        better = (ls < best[js]) | ((ls == best[js]) & (is_ < parent[js]))
        best[js[better]] = ls[better]
        parent[js[better]] = is_[better]

    if n > 1:
        tree = KDTree(xyz)
        index = np.arange(n, dtype=np.int64)
        log_k = log_cap + b * m
        for inner, outer in _shell_edges(r_min_km):
            log_r_inner = math.log10(max(inner, r_min_km))
            window = 10.0 ** (log_k - df * log_r_inner)
            hi = np.searchsorted(t, t + window, side="right").astype(np.int64)
            time_count = hi - index - 1
            space_first = np.zeros(n, dtype=bool)
            costly = np.flatnonzero(time_count > _TIME_FIRST_MAX)
            chord = _chord(outer) * (1 + 1e-9)
            if len(costly):
                space_count = tree.query_radius(xyz[costly], r=chord, count_only=True)
                space_first[costly[space_count < time_count[costly]]] = True

            # Time-first: every later event inside the window, any distance.
            time_first = np.flatnonzero(~space_first & (time_count > 0))
            counts = time_count[time_first]
            for chunk in _chunks(counts):
                parents, c = time_first[chunk], counts[chunk]
                ii = np.repeat(parents, c)
                offsets = np.arange(len(ii)) - np.repeat(np.cumsum(c) - c, c)
                evaluate(ii, ii + 1 + offsets, log_r_inner)

            # Space-first: every event inside the outer radius, then the time window.
            spatial = np.flatnonzero(space_first)
            for start in range(0, len(spatial), 4096):
                parents = spatial[start : start + 4096]
                found = tree.query_radius(xyz[parents], r=chord)
                lens = np.fromiter((len(f) for f in found), dtype=np.int64, count=len(found))
                if not lens.sum():
                    continue
                ii = np.repeat(parents, lens)
                jj = np.concatenate(found).astype(np.int64)
                keep = (jj > ii) & (t[jj] - t[ii] <= window[ii])
                evaluate(ii[keep], jj[keep], log_r_inner)

    censored = best >= log_cap
    parent[censored] = -1
    best[censored] = np.nan
    log_t = np.full(n, np.nan)
    log_r = np.full(n, np.nan)
    linked = parent >= 0
    p = parent[linked]
    dt = np.maximum(t[linked] - t[p], t_min_years)
    log_t[linked] = np.log10(dt) - q * b * m[p]
    log_r[linked] = best[linked] - log_t[linked]
    return NearestNeighbours(parent, best, log_t, log_r, pairs)


def _chunks(counts: IntArray, limit: int = _PAIR_CHUNK) -> list[slice]:
    """Consecutive slices of ``counts`` whose sums stay near ``limit``."""
    cum = np.cumsum(counts)
    out: list[slice] = []
    start, done = 0, 0
    while start < len(counts):
        stop = max(int(np.searchsorted(cum, done + limit, side="right")), start + 1)
        out.append(slice(start, stop))
        done, start = int(cum[stop - 1]), stop
    return out


# --------------------------------------------------------------------------- threshold


def fit_threshold(
    log_eta: npt.ArrayLike,
    *,
    censored_value: float | None = None,
    default: float = DEFAULT_LOG_THRESHOLD,
    max_samples: int = 200_000,
) -> Threshold:
    """Threshold between the clustered and background modes of ``log10(eta)``.

    Fits a two-component Gaussian mixture and returns the point between the two
    means where both components are equally likely. NaN values (no neighbour
    under the search cap) are background; they enter the fit at ``censored_value``
    when given. Falls back to ``default`` without two clear modes.
    """
    x = np.asarray(log_eta, dtype=float)
    if censored_value is not None:
        x = np.where(np.isnan(x), censored_value, x)
    x = x[np.isfinite(x)]
    if len(x) < 50:
        return Threshold(default, "default")
    if len(x) > max_samples:
        x = np.random.default_rng(0).choice(x, max_samples, replace=False)
    gmm = GaussianMixture(2, random_state=0, n_init=2).fit(x[:, None])
    means = gmm.means_.ravel()
    sds = np.sqrt(gmm.covariances_.ravel())
    weights = gmm.weights_
    order = np.argsort(means)
    means, sds, weights = means[order], sds[order], weights[order]
    params = {
        "means": tuple(round(float(v), 4) for v in means),
        "sds": tuple(round(float(v), 4) for v in sds),
        "weights": tuple(round(float(v), 4) for v in weights),
    }
    if means[1] - means[0] < 1.5 or weights.min() < 0.05:
        return Threshold(default, "default", **params)
    grid = np.linspace(means[0], means[1], 2001)
    posterior = gmm.predict_proba(grid[:, None])[:, order[0]]
    crossing = np.flatnonzero(posterior < 0.5)
    if len(crossing) == 0:
        return Threshold(default, "default", **params)
    return Threshold(round(float(grid[crossing[0]]), 3), "gaussian-mixture", **params)


# --------------------------------------------------------------------------- families


def assign_families(
    nn_parent: npt.ArrayLike, log_eta: npt.ArrayLike, magnitude: npt.ArrayLike, threshold: float
) -> Assignment:
    """Cut links at ``threshold`` and label families. Events must be in time order."""
    nn = np.asarray(nn_parent, dtype=np.int64)
    le = np.asarray(log_eta, dtype=float)
    mag = np.asarray(magnitude, dtype=float)
    n = len(nn)
    with np.errstate(invalid="ignore"):
        linked = (nn >= 0) & (le < threshold)
    parent = np.where(linked, nn, -1)
    root = np.arange(n, dtype=np.int64)
    generation = np.zeros(n, dtype=np.int64)
    # Parents always come earlier, so one pass in time order resolves every chain.
    root_l, gen_l, par_l = root.tolist(), generation.tolist(), parent.tolist()
    for j, p in enumerate(par_l):
        if p >= 0:
            root_l[j] = root_l[p]
            gen_l[j] = gen_l[p] + 1
    root = np.asarray(root_l, dtype=np.int64)
    generation = np.asarray(gen_l, dtype=np.int64)
    size = np.bincount(root, minlength=n)[root] if n else np.zeros(0, dtype=np.int64)
    # Mainshock: largest magnitude in the family; ties go to the earlier event.
    order = np.lexsort((np.arange(n), -mag, root))
    first = np.ones(n, dtype=bool)
    first[1:] = root[order][1:] != root[order][:-1]
    main_of_root = np.empty(n, dtype=np.int64)
    main_of_root[root[order][first]] = order[first]
    mainshock = main_of_root[root]
    idx = np.arange(n)
    role = np.full(n, ROLES["aftershock"], dtype=np.uint8)
    role[idx < mainshock] = ROLES["foreshock"]
    role[idx == mainshock] = ROLES["mainshock"]
    role[size == 1] = ROLES["single"]
    return Assignment(parent, root, generation, mainshock, size, role)


def build_families(
    catalog_path: Path,
    out_path: Path,
    *,
    min_magnitude: float | None = None,
    log_cap: float = LOG_ETA_CAP,
) -> FamiliesInfo:
    """Cluster the catalog's USGS events and write ``families.parquet``."""
    table = pq.read_table(
        catalog_path,
        columns=["rid", "event_id", "time", "latitude", "longitude", "magnitude", "source"],
    )
    rid = np.asarray(table.column("rid").to_numpy(), dtype=np.int64)
    time_ms = np.asarray(table.column("time").cast(pa.int64()).to_numpy(), dtype=np.int64)
    source = np.asarray(table.column("source").to_numpy(zero_copy_only=False))
    mag = np.asarray(table.column("magnitude").to_numpy(), dtype=float)
    keep = source == "usgs"
    if min_magnitude is not None:
        keep &= mag >= min_magnitude - 1e-6
    sel = np.flatnonzero(keep)
    sel = sel[np.lexsort((rid[sel], time_ms[sel]))]
    lat = np.asarray(table.column("latitude").to_numpy(), dtype=float)[sel]
    lon = np.asarray(table.column("longitude").to_numpy(), dtype=float)[sel]
    t_years = time_ms[sel] / MS_PER_YEAR
    mag = mag[sel]
    rids = rid[sel]
    event_ids = table.column("event_id").take(pa.array(sel))

    log.info("Finding nearest neighbours for %d instrumental events", len(sel))
    nn = nearest_neighbours(t_years, lat, lon, mag, log_cap=log_cap)
    censored = int(np.isnan(nn.log_eta).sum())
    threshold = fit_threshold(nn.log_eta, censored_value=log_cap)
    if threshold.log_eta > log_cap - 1.0:
        log.warning(
            "Threshold %.2f is close to the search cap %.2f; links may be missed",
            threshold.log_eta,
            log_cap,
        )
    fam = assign_families(nn.parent, nn.log_eta, mag, threshold.log_eta)

    def rid_or_null(idx: IntArray) -> pa.Array:
        return pa.array(
            np.where(idx >= 0, rids[np.maximum(idx, 0)], 0), mask=idx < 0, type=pa.uint32()
        )

    out = pa.table(
        {
            "rid": pa.array(rids, type=pa.uint32()),
            "event_id": event_ids,
            "parent_rid": rid_or_null(fam.parent),
            "nn_parent_rid": rid_or_null(nn.parent),
            "log_eta": pa.array(nn.log_eta, type=pa.float32(), from_pandas=True),
            "log_t": pa.array(nn.log_t, type=pa.float32(), from_pandas=True),
            "log_r": pa.array(nn.log_r, type=pa.float32(), from_pandas=True),
            "cluster_id": pa.array(rids[fam.root], type=pa.uint32()),
            "mainshock_rid": pa.array(rids[fam.mainshock], type=pa.uint32()),
            "generation": pa.array(fam.generation, type=pa.uint32()),
            "role": pa.array(fam.role, type=pa.uint8()),
            "family_size": pa.array(fam.size, type=pa.uint32()),
        }
    )
    info = FamiliesInfo(
        threshold=threshold.log_eta,
        threshold_method=threshold.method,
        b_value=B_VALUE,
        fractal_dimension=FRACTAL_DIMENSION,
        q=Q_SPLIT,
        log_eta_cap=log_cap,
        r_min_km=R_MIN_KM,
        min_magnitude=min_magnitude,
        analysed=len(sel),
        censored=censored,
        pairs_evaluated=nn.pairs_evaluated,
        built_at=datetime.now(UTC).isoformat(timespec="seconds"),
        gmm={
            "means": list(threshold.means),
            "sds": list(threshold.sds),
            "weights": list(threshold.weights),
        },
    )
    out = out.replace_schema_metadata({METADATA_KEY: info.to_json()})
    write_parquet(out, out_path)
    clustered = int(np.isin(fam.role, DEPENDENT_ROLES).sum())
    log.info(
        "Families: threshold log10(eta) = %.2f (%s); %d of %d events are foreshocks or "
        "aftershocks; %d families with 2+ events; %d pairs evaluated -> %s",
        threshold.log_eta,
        threshold.method,
        clustered,
        len(sel),
        int((fam.size[fam.role == ROLES["mainshock"]] > 1).sum()),
        nn.pairs_evaluated,
        out_path,
    )
    return info


def trim_members(
    rid: npt.ArrayLike,
    parent_rid: npt.ArrayLike,
    magnitude: npt.ArrayLike,
    must_keep: set[int],
    limit: int,
) -> tuple[npt.NDArray[np.bool_], IntArray]:
    """Choose at most about ``limit`` members of a large family to send to the client.

    Keeps ``must_keep`` (with all their ancestors), then the strongest others.
    Returns the kept mask and, per member, its nearest kept ancestor (-1 for
    none), so the trimmed set still forms a tree. Members are in time order.
    """
    rid = np.asarray(rid, dtype=np.int64)
    parent = np.asarray(parent_rid, dtype=np.int64)
    n = len(rid)
    if n <= limit:
        return np.ones(n, dtype=bool), parent
    pos = {int(r): i for i, r in enumerate(rid)}
    keep = np.zeros(n, dtype=bool)
    for r in must_keep:
        i = pos.get(int(r))
        while i is not None and not keep[i]:
            keep[i] = True
            i = pos.get(int(parent[i])) if parent[i] >= 0 else None
    room = limit - int(keep.sum())
    if room > 0:
        strongest = np.lexsort((np.arange(n), -np.asarray(magnitude, dtype=float)))
        keep[strongest[~keep[strongest]][:room]] = True
    display = parent.copy()
    for i in np.flatnonzero(keep):
        p = int(parent[i])
        while p >= 0 and not keep[pos[p]]:
            p = int(parent[pos[p]])
        display[i] = p
    return keep, display


def read_info(path: Path) -> FamiliesInfo | None:
    """Build metadata of a ``families.parquet`` file, or ``None`` if it has none."""
    metadata = pq.read_schema(path).metadata or {}
    raw = metadata.get(METADATA_KEY)
    return FamiliesInfo.from_json(raw) if raw else None
