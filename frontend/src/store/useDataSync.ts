import { useEffect, useMemo, useState } from 'react';
import { needsRefetch, toServerQuery } from '../lib/filters';
import { useQuakeStore } from './useQuakeStore';

/** Debounce delay between the last filter change and the refetch. */
export const FILTER_DEBOUNCE_MS = 350;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Keeps server data in step with the filters.
 *
 * Filters reach the GPU instantly; this hook only refetches (after a debounce)
 * when the loaded events can't answer the new filters. The summary is always
 * refetched because its counts must cover every matching event; the server
 * caches it, so this is cheap. The timeline histogram ignores the date range
 * (it always spans the whole catalog), so it reloads only when other filters change.
 */
export function useDataSync(): void {
  const meta = useQuakeStore((s) => s.meta);
  const filters = useQuakeStore((s) => s.filters);
  const reloadToken = useQuakeStore((s) => s.reloadToken);
  const loadMeta = useQuakeStore((s) => s.loadMeta);
  const debounced = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);

  useEffect(() => {
    if (!useQuakeStore.getState().meta) void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    // Skip the stale debounced value from before meta loaded or filters were reset.
    if (!meta || !debounced) return;
    const query = toServerQuery(debounced, meta);
    if (query.sources?.length === 0) return; // nothing to show; the map hides everything
    const { events, loadEvents, loadSummary } = useQuakeStore.getState();
    const controller = new AbortController();
    if (needsRefetch(events, query)) void loadEvents(query, controller.signal);
    void loadSummary(query, controller.signal);
    return () => controller.abort();
  }, [meta, debounced, reloadToken]);

  const timelineQuery = useMemo(() => {
    if (!meta || !debounced) return null;
    const { start: _start, end: _end, ...rest } = toServerQuery(debounced, meta);
    return rest;
  }, [meta, debounced]);
  const timelineKey = JSON.stringify(timelineQuery);

  useEffect(() => {
    if (!timelineQuery || timelineQuery.sources?.length === 0) return;
    const controller = new AbortController();
    void useQuakeStore.getState().loadTimelineSummary(timelineQuery, controller.signal);
    return () => controller.abort();
    // timelineKey captures every field of timelineQuery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineKey, reloadToken]);
}

/** Loads the family of the selected event whenever the selection changes (if families exist). */
export function useFamilySync(): void {
  const rid = useQuakeStore((s) => s.pinned?.rid ?? null);
  const ready = useQuakeStore((s) => s.meta?.families_ready ?? false);
  useEffect(() => {
    if (rid == null || !ready) return;
    const controller = new AbortController();
    void useQuakeStore.getState().loadFamily(rid, controller.signal);
    return () => controller.abort();
  }, [rid, ready]);
}
