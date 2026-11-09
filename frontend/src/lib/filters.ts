/**
 * Client filter state, the server query it implies, and the GPU filter ranges.
 *
 * Strategy: every filter change is applied to the GPU immediately (DataFilterExtension),
 * and a debounced refetch happens only when the loaded data cannot answer the new
 * filters, i.e. the new query asks for events outside what was loaded, or the
 * loaded set was downsampled (so narrowing could reveal events that were cut).
 */
import type { Meta, ServerQuery } from '../api/types';
import { yearStartMs } from './time';

export interface Filters {
  /** Inclusive astronomical years. */
  yearRange: [number, number];
  magRange: [number, number];
  depthRange: [number, number];
  /** Enabled source ids. */
  sources: string[];
}

export interface Playback {
  /** When false the whole date range is shown. */
  windowEnabled: boolean;
  /** Rolling shows `[start, start + size)`; cumulative shows everything up to `start + size`. */
  mode: 'rolling' | 'cumulative';
  /** Fractional year. */
  windowStart: number;
  /** Years. */
  windowSize: number;
  playing: boolean;
  /** Years per second. */
  speed: number;
}

/** Sentinel written into the GPU depth attribute for unknown depth. */
export const UNKNOWN_DEPTH_FILTER = -9999;
const OPEN = 1e9;
/** Shrinks an inclusive GPU range by ~1 hour to emulate an exclusive upper bound. */
const EXCLUSIVE_EPSILON = 1e-4;

/** Dataset magnitude bounds rounded outward to 0.1 (tolerant of float32 noise: 9.1000004 → 9.1). */
export function magBounds(meta: Meta): [number, number] {
  return [Math.floor(meta.magnitude.min * 10 + 1e-6) / 10, Math.ceil(meta.magnitude.max * 10 - 1e-6) / 10];
}

export function depthBounds(meta: Meta): [number, number] {
  return [Math.floor(Math.min(0, meta.depth.min)), Math.ceil(Math.max(meta.depth.max, 1))];
}

export function defaultFilters(meta: Meta): Filters {
  return {
    yearRange: [meta.min_year, meta.max_year],
    magRange: magBounds(meta),
    depthRange: depthBounds(meta),
    sources: meta.sources.map((s) => s.id),
  };
}

export function isDepthActive(filters: Filters, meta: Meta): boolean {
  const [lo, hi] = depthBounds(meta);
  return filters.depthRange[0] > lo || filters.depthRange[1] < hi;
}

/** The server query for the filters. Bounds equal to the dataset bounds are omitted. */
export function toServerQuery(filters: Filters, meta: Meta): ServerQuery {
  const q: ServerQuery = {};
  const [y0, y1] = filters.yearRange;
  if (y0 > meta.min_year) q.start = yearStartMs(y0);
  if (y1 < meta.max_year) q.end = yearStartMs(y1 + 1);
  const [m0, m1] = magBounds(meta);
  if (filters.magRange[0] > m0) q.minMag = filters.magRange[0];
  if (filters.magRange[1] < m1) q.maxMag = filters.magRange[1];
  if (isDepthActive(filters, meta)) {
    q.minDepth = filters.depthRange[0];
    q.maxDepth = filters.depthRange[1];
  }
  const all = meta.sources.map((s) => s.id);
  if (!all.every((id) => filters.sources.includes(id))) {
    q.sources = all.filter((id) => filters.sources.includes(id));
  }
  return q;
}

export function queryEquals(a: ServerQuery, b: ServerQuery): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(q: ServerQuery): ServerQuery {
  return {
    start: q.start,
    end: q.end,
    minMag: q.minMag,
    maxMag: q.maxMag,
    minDepth: q.minDepth,
    maxDepth: q.maxDepth,
    sources: q.sources ? [...q.sources].sort() : undefined,
  };
}

const looserLow = (loaded?: number, needed?: number) =>
  loaded === undefined || (needed !== undefined && loaded <= needed);
const looserHigh = (loaded?: number, needed?: number) =>
  loaded === undefined || (needed !== undefined && loaded >= needed);

/** True if every event matching `needed` is also matched by `loaded`. */
export function covers(loaded: ServerQuery, needed: ServerQuery): boolean {
  const depthOk =
    loaded.minDepth === undefined && loaded.maxDepth === undefined
      ? true
      : needed.minDepth !== undefined &&
        looserLow(loaded.minDepth, needed.minDepth) &&
        looserHigh(loaded.maxDepth, needed.maxDepth);
  const sourcesOk =
    loaded.sources === undefined ||
    (needed.sources !== undefined && needed.sources.every((s) => loaded.sources!.includes(s)));
  return (
    looserLow(loaded.start, needed.start) &&
    looserHigh(loaded.end, needed.end) &&
    looserLow(loaded.minMag, needed.minMag) &&
    looserHigh(loaded.maxMag, needed.maxMag) &&
    depthOk &&
    sourcesOk
  );
}

/** Whether the loaded events must be replaced to answer `needed`. */
export function needsRefetch(
  loaded: { query: ServerQuery; downsampled: boolean } | null,
  needed: ServerQuery,
): boolean {
  if (!loaded) return true;
  if (loaded.downsampled) return !queryEquals(loaded.query, needed);
  return !covers(loaded.query, needed);
}

export function toSearchParams(q: ServerQuery): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v?: number) => v !== undefined && p.set(k, String(v));
  set('start', q.start);
  set('end', q.end);
  set('min_mag', q.minMag);
  set('max_mag', q.maxMag);
  set('min_depth', q.minDepth);
  set('max_depth', q.maxDepth);
  q.sources?.forEach((s) => p.append('sources', s));
  return p;
}

/** The time window currently shown, as fractional years `[start, end)`. */
export function visibleWindow(filters: Filters, playback: Playback): [number, number] {
  const lo = filters.yearRange[0];
  const hi = filters.yearRange[1] + 1;
  if (!playback.windowEnabled) return [lo, hi];
  const end = Math.min(hi, playback.windowStart + playback.windowSize);
  const start = playback.mode === 'cumulative' ? lo : Math.max(lo, playback.windowStart);
  return [start, end];
}

/**
 * GPU filter ranges, one per filter dimension:
 * `[decimal year, magnitude, depth (unknown = -9999), source code]`.
 * Returns `null` when nothing can match (e.g. every source switched off).
 */
export function gpuFilterRange(
  filters: Filters,
  meta: Meta,
  playback: Playback,
): [number, number][] | null {
  const codes = meta.sources.filter((s) => filters.sources.includes(s.id)).map((s) => s.code);
  if (codes.length === 0) return null;
  const [t0, t1] = visibleWindow(filters, playback);
  const depth: [number, number] = isDepthActive(filters, meta)
    ? [filters.depthRange[0], filters.depthRange[1]]
    : [-OPEN, OPEN];
  return [
    [t0, t1 - EXCLUSIVE_EPSILON],
    [filters.magRange[0], filters.magRange[1]],
    depth,
    [Math.min(...codes), Math.max(...codes)],
  ];
}
