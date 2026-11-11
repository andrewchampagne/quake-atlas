/**
 * Global app state: dataset metadata, filters, loaded data, playback and selection.
 *
 * Components subscribe with narrow selectors so a playback tick (60 times a second)
 * only re-renders what depends on the time window.
 */
import { create } from 'zustand';
import {
  ApiError,
  fetchEventDetail,
  fetchEvents,
  fetchFamily,
  fetchFamilyStats,
  fetchMeta,
  fetchSummary,
  isAbortError,
} from '../api/client';
import type {
  EventColumns,
  EventsMeta,
  Family,
  FamilyStats,
  Meta,
  ServerQuery,
  Summary,
} from '../api/types';
import { buildAttributes, type GpuAttributes } from '../lib/attributes';
import { defaultFilters, type Filters, type Playback } from '../lib/filters';
import type { InspectorTab } from '../lib/urlState';
import {
  advance,
  clampPlayback,
  defaultSpeed,
  defaultWindowSize,
  play,
} from '../lib/playback';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface EventsData extends EventColumns, GpuAttributes, EventsMeta {
  /** The server query this data answers (a superset of the current filters). */
  query: ServerQuery;
}

export interface HoverInfo {
  index: number;
  x: number;
  y: number;
}

export interface PinnedEvent {
  rid: number;
  longitude: number;
  latitude: number;
  magnitude: number;
}

export interface FlyTarget {
  longitude: number;
  latitude: number;
  zoom: number;
  /** Changes on every request so repeated flights to the same place still animate. */
  nonce: number;
}

export interface QuakeState {
  meta: Meta | null;
  metaStatus: Status;
  metaError: string | null;

  filters: Filters | null;

  events: EventsData | null;
  eventsStatus: Status;
  eventsError: string | null;

  summary: Summary | null;
  summaryStatus: Status;
  summaryError: string | null;
  /** Per-year counts over the whole catalog span (all filters except dates), for the timeline. */
  timelineSummary: Summary | null;
  /** Bumped by {@link QuakeState.retry} to force a refetch. */
  reloadToken: number;

  playback: Playback;
  /** Points passing the GPU filter, reported by deck.gl. */
  visibleCount: number | null;

  hover: HoverInfo | null;
  pinned: PinnedEvent | null;
  flyTarget: FlyTarget | null;

  /** Family of the pinned event (may briefly belong to the previous pin while loading). */
  family: Family | null;
  familyStatus: Status;
  familyError: string | null;
  familyStats: FamilyStats | null;

  /** Tab shown for the selected event; kept while moving between events. */
  inspectorTab: InspectorTab;
  inspectorCollapsed: boolean;

  loadMeta: () => Promise<void>;
  loadEvents: (query: ServerQuery, signal: AbortSignal) => Promise<void>;
  loadSummary: (query: ServerQuery, signal: AbortSignal) => Promise<void>;
  loadTimelineSummary: (query: ServerQuery, signal: AbortSignal) => Promise<void>;
  retry: () => void;
  loadFamily: (rid: number, signal: AbortSignal) => Promise<void>;
  loadFamilyStats: () => Promise<void>;
  setInspectorTab: (tab: InspectorTab) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;

  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;

  setPlayback: (patch: Partial<Playback>) => void;
  togglePlay: () => void;
  tick: (dtSeconds: number) => void;
  focusPeriod: (startYear: number, endYear: number) => void;
  /** Show the whole date range again (stops playback). */
  clearWindow: () => void;
  /** Move the window one window-length back (-1) or forward (1), turning it on if needed. */
  stepWindow: (direction: -1 | 1) => void;

  setVisibleCount: (count: number | null) => void;
  setHover: (hover: HoverInfo | null) => void;
  pin: (event: PinnedEvent | null) => void;
  /** Select an event by id (looks up its location), optionally flying to it. */
  select: (rid: number, options?: { fly?: boolean }) => Promise<void>;
  flyTo: (longitude: number, latitude: number, zoom?: number) => void;
}

const INITIAL_PLAYBACK: Playback = {
  windowEnabled: false,
  mode: 'rolling',
  windowStart: 0,
  windowSize: 1,
  playing: false,
  speed: 1,
};

// Monotonic request ids: only the latest request may update its slice of state.
let eventsRequest = 0;
let summaryRequest = 0;
let timelineRequest = 0;
let selectRequest = 0;
// Shared by every caller while the (static) family statistics are loading.
let familyStatsRequest: Promise<void> | null = null;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return String(err);
}

function playbackFor(filters: Filters): Playback {
  return {
    ...INITIAL_PLAYBACK,
    windowStart: filters.yearRange[0],
    windowSize: defaultWindowSize(filters),
    speed: defaultSpeed(filters),
  };
}

export const useQuakeStore = create<QuakeState>()((set, get) => ({
  meta: null,
  metaStatus: 'idle',
  metaError: null,
  filters: null,
  events: null,
  eventsStatus: 'idle',
  eventsError: null,
  summary: null,
  summaryStatus: 'idle',
  summaryError: null,
  timelineSummary: null,
  reloadToken: 0,
  playback: INITIAL_PLAYBACK,
  visibleCount: null,
  hover: null,
  pinned: null,
  flyTarget: null,
  family: null,
  familyStatus: 'idle',
  familyError: null,
  familyStats: null,
  inspectorTab: 'details',
  inspectorCollapsed: false,

  async loadMeta() {
    // One request at a time: a second response would reset filters applied from the URL.
    if (get().metaStatus === 'loading') return;
    set({ metaStatus: 'loading', metaError: null });
    try {
      const meta = await fetchMeta();
      const filters = defaultFilters(meta);
      set({ meta, metaStatus: 'ready', filters, playback: playbackFor(filters) });
    } catch (err) {
      set({ metaStatus: 'error', metaError: errorMessage(err) });
    }
  },

  async loadEvents(query, signal) {
    const id = ++eventsRequest;
    set({ eventsStatus: 'loading', eventsError: null });
    try {
      const { columns, meta } = await fetchEvents(query, signal);
      if (id !== eventsRequest) return;
      const events: EventsData = { ...columns, ...buildAttributes(columns), ...meta, query };
      set({ events, eventsStatus: 'ready', hover: null });
    } catch (err) {
      if (id !== eventsRequest) return; // superseded: the newer request owns the status
      if (isAbortError(err)) {
        set({ eventsStatus: get().events ? 'ready' : 'idle' });
      } else {
        set({ eventsStatus: 'error', eventsError: errorMessage(err) });
      }
    }
  },

  async loadSummary(query, signal) {
    const id = ++summaryRequest;
    set({ summaryStatus: 'loading', summaryError: null });
    try {
      const summary = await fetchSummary(query, signal);
      if (id !== summaryRequest) return;
      set({ summary, summaryStatus: 'ready' });
    } catch (err) {
      if (id !== summaryRequest) return;
      if (isAbortError(err)) {
        set({ summaryStatus: get().summary ? 'ready' : 'idle' });
      } else {
        set({ summaryStatus: 'error', summaryError: errorMessage(err) });
      }
    }
  },

  async loadTimelineSummary(query, signal) {
    const id = ++timelineRequest;
    try {
      const summary = await fetchSummary(query, signal);
      if (id === timelineRequest) set({ timelineSummary: summary });
    } catch {
      /* the track simply keeps its previous histogram */
    }
  },

  retry() {
    const { metaStatus } = get();
    if (metaStatus === 'error') {
      void get().loadMeta();
      return;
    }
    set((s) => ({ reloadToken: s.reloadToken + 1, events: s.eventsStatus === 'error' ? null : s.events }));
  },

  async loadFamily(rid, signal) {
    set({ familyStatus: 'loading', familyError: null });
    try {
      const family = await fetchFamily(rid);
      if (signal.aborted || get().pinned?.rid !== rid) return;
      set({ family, familyStatus: 'ready' });
    } catch (err) {
      if (signal.aborted) return;
      set({ familyStatus: 'error', familyError: errorMessage(err) });
    }
  },

  loadFamilyStats() {
    if (get().familyStats) return Promise.resolve();
    familyStatsRequest ??= fetchFamilyStats()
      .then((familyStats) => set({ familyStats }))
      .catch(() => {
        familyStatsRequest = null; // the sidebar omits the statistics; a later call retries
      });
    return familyStatsRequest;
  },

  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setInspectorCollapsed: (inspectorCollapsed) => set({ inspectorCollapsed }),

  setFilters(patch) {
    const current = get().filters;
    if (!current) return;
    const filters = { ...current, ...patch };
    let playback = get().playback;
    const rangeChanged =
      filters.yearRange[0] !== current.yearRange[0] || filters.yearRange[1] !== current.yearRange[1];
    if (rangeChanged) {
      // Keep playback proportionate: 100 yr/s suits 4,000 years, not 25.
      playback = { ...playback, speed: defaultSpeed(filters), windowSize: defaultWindowSize(filters) };
    }
    set({ filters, playback: clampPlayback(playback, filters) });
  },

  resetFilters() {
    const { meta } = get();
    if (!meta) return;
    const filters = defaultFilters(meta);
    set({ filters, playback: playbackFor(filters) });
  },

  setPlayback(patch) {
    const { filters, playback } = get();
    const next = { ...playback, ...patch };
    set({ playback: filters ? clampPlayback(next, filters) : next });
  },

  togglePlay() {
    const { filters, playback } = get();
    if (!filters) return;
    set({ playback: playback.playing ? { ...playback, playing: false } : play(playback, filters) });
  },

  tick(dtSeconds) {
    const { filters, playback } = get();
    if (!filters || !playback.playing) return;
    set({ playback: advance(playback, filters, dtSeconds) });
  },

  focusPeriod(startYear, endYear) {
    const { filters, playback } = get();
    if (!filters) return;
    const next: Playback = {
      ...playback,
      windowEnabled: true,
      mode: 'rolling',
      playing: false,
      windowStart: startYear,
      windowSize: endYear - startYear,
    };
    set({ playback: clampPlayback(next, filters) });
  },

  clearWindow() {
    set((s) => ({ playback: { ...s.playback, windowEnabled: false, playing: false } }));
  },

  stepWindow(direction) {
    const { filters, playback } = get();
    if (!filters) return;
    const start = playback.windowEnabled
      ? playback.windowStart + direction * playback.windowSize
      : direction > 0
        ? filters.yearRange[0]
        : filters.yearRange[1] + 1 - playback.windowSize;
    set({ playback: clampPlayback({ ...playback, windowEnabled: true, playing: false, windowStart: start }, filters) });
  },

  setVisibleCount: (visibleCount) => set({ visibleCount }),
  setHover: (hover) => set({ hover }),
  pin: (pinned) => {
    ++selectRequest; // a direct pin supersedes any pending lookup
    set(pinned ? { pinned, inspectorCollapsed: false } : { pinned, family: null, familyStatus: 'idle', inspectorTab: 'details' });
  },

  async select(rid, options = {}) {
    const id = ++selectRequest;
    try {
      const detail = await fetchEventDetail(rid);
      if (id !== selectRequest) return;
      const { longitude, latitude, magnitude } = detail;
      set({ pinned: { rid, longitude, latitude, magnitude }, inspectorCollapsed: false });
      if (options.fly) get().flyTo(longitude, latitude, 4);
    } catch {
      /* unknown id (stale link): stay on the overview */
    }
  },
  flyTo(longitude, latitude, zoom = 4) {
    set({ flyTarget: { longitude, latitude, zoom, nonce: Date.now() } });
  },
}));
