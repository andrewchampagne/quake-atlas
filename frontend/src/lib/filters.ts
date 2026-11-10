/**
 * Client filter state, the server query it implies, and the GPU filter ranges.
 *
 * Strategy: every filter change is applied to the GPU immediately (DataFilterExtension),
 * and a debounced refetch happens only when the loaded data cannot answer the new
 * filters, i.e. the new query asks for events outside what was loaded, or the
 * loaded set was downsampled (so narrowing could reveal events that were cut).
 */
import { decodeDeathToll } from '../api/deaths';
import type { EventColumns, Meta, ServerQuery, StrongestEvent, Summary, YearCount } from '../api/types';
import { decimalYearToMs, yearOf, yearStartMs } from './time';

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
    deadlyOnly: q.deadlyOnly || undefined,
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
    sourcesOk &&
    (!loaded.deadlyOnly || needed.deadlyOnly === true)
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
  if (q.deadlyOnly) p.set('deadly_only', 'true');
  return p;
}

/**
 * Summarize a complete loaded catalog for the active filters/window. Callers must
 * check query coverage and downsampling before using these as catalog totals.
 * Approximate NOAA ranges count as deadly events, never as exact deaths.
 */
export function summarizeEvents(
  events: EventColumns,
  filters: Filters,
  meta: Meta,
  playback: Playback,
): Summary {
  const [start, end] = visibleWindow(filters, playback).map(decimalYearToMs);
  const sources = new Map(meta.sources.map((source) => [source.code, source.id]));
  const enabled = new Set(meta.sources.filter((s) => filters.sources.includes(s.id)).map((s) => s.code));
  const depthActive = isDepthActive(filters, meta);
  const years = new Map<number, YearCount>();
  let total = 0;
  let totalDeaths = 0;
  let deadly = 0;
  let approximate = 0;
  let strongest: StrongestEvent | null = null;
  let deadliest: StrongestEvent | null = null;
  let deadliestRank = -1;
  const eventAt = (i: number): StrongestEvent => ({
    rid: events.rid[i],
    event_id: '',
    time: events.time[i],
    longitude: events.lon[i],
    latitude: events.lat[i],
    depth_km: Number.isNaN(events.depth[i]) ? null : events.depth[i],
    magnitude: events.magnitude[i],
    place: null,
    source: sources.get(events.source[i]) ?? String(events.source[i]),
    ...decodeDeathToll(events.deaths?.[i]),
  });
  for (let i = 0; i < events.length; i++) {
    const magnitude = events.magnitude[i];
    const depth = events.depth[i];
    if (
      events.time[i] < start || events.time[i] >= end ||
      magnitude < filters.magRange[0] - 1e-6 || magnitude > filters.magRange[1] + 1e-6 ||
      !enabled.has(events.source[i]) ||
      (depthActive && (!Number.isFinite(depth) || depth < filters.depthRange[0] || depth > filters.depthRange[1]))
    ) continue;

    total++;
    const { deaths, deaths_order: order } = decodeDeathToll(events.deaths?.[i]);
    const year = yearOf(events.time[i]);
    const annual = years.get(year) ?? { year, count: 0, deaths: events.deaths ? 0 : undefined };
    annual.count++;
    if (annual.deaths !== undefined) annual.deaths += deaths ?? 0;
    years.set(year, annual);
    totalDeaths += deaths ?? 0;
    const isDeadly = (deaths ?? 0) > 0 || (order ?? 0) > 0;
    if (isDeadly) deadly++;
    if (deaths == null && (order ?? 0) > 0) approximate++;

    const source = sources.get(events.source[i]);
    if (!strongest || magnitude > strongest.magnitude ||
      (magnitude === strongest.magnitude && (
        (source !== 'noaa' && strongest.source === 'noaa') ||
        ((source === 'noaa') === (strongest.source === 'noaa') &&
          (events.time[i] < strongest.time || (events.time[i] === strongest.time && events.rid[i] < strongest.rid)))
      ))) strongest = eventAt(i);

    const rank = deaths ?? ([0, 1, 51, 101, 1001][order ?? 0] ?? 0);
    if (isDeadly && (!deadliest || rank > deadliestRank ||
      (rank === deadliestRank && (magnitude > deadliest.magnitude ||
        (magnitude === deadliest.magnitude && events.rid[i] < deadliest.rid))))) {
      deadliest = eventAt(i);
      deadliestRank = rank;
    }
  }
  return {
    total,
    strongest,
    deadliest,
    per_year: [...years.values()].sort((a, b) => a.year - b.year),
    total_deaths: events.deaths ? totalDeaths : undefined,
    deadly_events: events.deaths ? deadly : undefined,
    approx_deadly_events: events.deaths ? approximate : undefined,
  };
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
