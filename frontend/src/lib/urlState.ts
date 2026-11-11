/**
 * Shareable app state in the URL hash, e.g.
 * `#/explore?y=1900..2024&m=6..9.1&d=0..70&src=usgs&dc=1&e=21169&tab=family&w=1990..5`.
 *
 * Only values that differ from the defaults are written, so the plain app URL
 * stays clean. Parsing is lenient: unknown or malformed values are ignored and
 * everything is clamped to the dataset when applied.
 */
import type { Meta } from '../api/types';
import { defaultFilters, depthBounds, magBounds, type Filters, type Playback } from './filters';

export type View = 'explore' | 'simulate';
export type InspectorTab = 'details' | 'family' | 'forecast';
const TABS: readonly InspectorTab[] = ['details', 'family', 'forecast'];

export interface UrlWindow {
  start: number;
  size: number;
  cumulative: boolean;
}

export interface UrlState {
  view: View;
  years?: [number, number];
  mag?: [number, number];
  depth?: [number, number];
  sources?: string[];
  declustered?: boolean;
  event?: number;
  tab?: InspectorTab;
  window?: UrlWindow;
}

function parseRange(raw: string | null): [number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw.split('..');
  if (parts.length !== 2) return undefined;
  const [a, b] = parts.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && a <= b ? [a, b] : undefined;
}

const round = (v: number, digits = 2) => Number(v.toFixed(digits));
const range = ([a, b]: [number, number]) => `${round(a)}..${round(b)}`;

export function parseHash(hash: string): UrlState {
  const clean = hash.replace(/^#/, '');
  const [path, query = ''] = clean.split('?');
  const view: View = path.replace(/^\//, '') === 'simulate' ? 'simulate' : 'explore';
  const q = new URLSearchParams(query);
  const state: UrlState = { view };
  state.years = parseRange(q.get('y'));
  state.mag = parseRange(q.get('m'));
  state.depth = parseRange(q.get('d'));
  if (q.has('src')) state.sources = q.get('src')!.split(',').filter(Boolean);
  if (q.get('dc') === '1') state.declustered = true;
  const event = Number(q.get('e'));
  if (q.has('e') && Number.isInteger(event) && event >= 0) state.event = event;
  const tab = q.get('tab') as InspectorTab | null;
  if (tab && TABS.includes(tab)) state.tab = tab;
  // Window is `start..size` (start may be negative for BCE).
  const w = q.get('w')?.split('..').map(Number);
  if (w?.length === 2 && w.every(Number.isFinite) && w[1] > 0) {
    state.window = { start: w[0], size: w[1], cumulative: q.get('acc') === '1' };
  }
  return state;
}

export function serializeHash(state: UrlState): string {
  const q = new URLSearchParams();
  if (state.years) q.set('y', range(state.years));
  if (state.mag) q.set('m', range(state.mag));
  if (state.depth) q.set('d', range(state.depth));
  if (state.sources) q.set('src', state.sources.join(','));
  if (state.declustered) q.set('dc', '1');
  if (state.event != null) q.set('e', String(state.event));
  if (state.tab && state.tab !== 'details') q.set('tab', state.tab);
  if (state.window) {
    q.set('w', `${round(state.window.start)}..${round(state.window.size)}`);
    if (state.window.cumulative) q.set('acc', '1');
  }
  const query = q.toString().replace(/%2C/g, ',');
  return `#/${state.view}${query ? `?${query}` : ''}`;
}

const sameRange = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** URL state for the current app state, omitting anything at its default. */
export function urlStateFrom(args: {
  view: View;
  filters: Filters | null;
  meta: Meta | null;
  playback: Playback;
  event: number | null;
  tab: InspectorTab;
}): UrlState {
  const { view, filters, meta, playback, event, tab } = args;
  const state: UrlState = { view };
  if (view !== 'explore' || !filters || !meta) return state;
  const defaults = defaultFilters(meta);
  if (!sameRange(filters.yearRange, defaults.yearRange)) state.years = filters.yearRange;
  if (!sameRange(filters.magRange, defaults.magRange)) state.mag = filters.magRange;
  if (!sameRange(filters.depthRange, defaults.depthRange)) state.depth = filters.depthRange;
  if (filters.sources.length !== defaults.sources.length || !defaults.sources.every((s) => filters.sources.includes(s))) {
    state.sources = defaults.sources.filter((s) => filters.sources.includes(s));
  }
  if (filters.declustered) state.declustered = true;
  if (event != null) {
    state.event = event;
    if (tab !== 'details') state.tab = tab;
  }
  if (playback.windowEnabled) {
    state.window = { start: playback.windowStart, size: playback.windowSize, cumulative: playback.mode === 'cumulative' };
  }
  return state;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampRange = ([a, b]: [number, number], [lo, hi]: [number, number]): [number, number] => [
  clamp(a, lo, hi),
  clamp(b, lo, hi),
];

/** Filters described by the URL, clamped to the dataset; unspecified fields use defaults. */
export function filtersFromUrl(state: UrlState, meta: Meta): Filters {
  const f = defaultFilters(meta);
  const years: [number, number] = [meta.min_year, meta.max_year];
  if (state.years) f.yearRange = clampRange(state.years, years).map(Math.round) as [number, number];
  if (state.mag) f.magRange = clampRange(state.mag, magBounds(meta));
  if (state.depth) f.depthRange = clampRange(state.depth, depthBounds(meta));
  if (state.sources) f.sources = f.sources.filter((s) => state.sources!.includes(s));
  f.declustered = Boolean(state.declustered && meta.families_ready);
  return f;
}
