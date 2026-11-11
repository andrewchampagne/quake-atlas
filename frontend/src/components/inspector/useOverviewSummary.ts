import { useMemo } from 'react';
import type { StrongestEvent, Summary } from '../../api/types';
import { covers, summarizeEvents, toServerQuery } from '../../lib/filters';
import { useQuakeStore } from '../../store/useQuakeStore';

export interface OverviewSummary {
  /** Local stats for the playback window when the loaded data is complete, else the server's. */
  summary: Summary | null;
  /** True when the numbers describe the playback window rather than the whole range. */
  windowed: boolean;
  /** The window is on but only full-range server totals are available. */
  windowUnavailable: boolean;
  refreshing: boolean;
  /** Fill in place/event id for local events the server summary already knows. */
  withDetails: (event: StrongestEvent | null | undefined) => StrongestEvent | null;
}

export function useOverviewSummary(): OverviewSummary {
  const serverSummary = useQuakeStore((s) => s.summary);
  const summaryStatus = useQuakeStore((s) => s.summaryStatus);
  const filters = useQuakeStore((s) => s.filters);
  const meta = useQuakeStore((s) => s.meta);
  const events = useQuakeStore((s) => s.events);
  const playback = useQuakeStore((s) => s.playback);

  const local = useMemo(() => {
    if (!events || !filters || !meta || events.downsampled || !covers(events.query, toServerQuery(filters, meta))) return null;
    return summarizeEvents(events, filters, meta, playback);
  }, [events, filters, meta, playback]);
  const summary = local ?? serverSummary;
  const noSources = filters?.sources.length === 0;

  return {
    summary: noSources && summary ? { ...summary, total: 0, total_deaths: 0, deadly_events: 0, strongest: null, deadliest: null } : summary,
    windowed: Boolean(local && playback.windowEnabled),
    windowUnavailable: Boolean(!local && playback.windowEnabled),
    refreshing: !local && summaryStatus === 'loading' && summary !== null,
    withDetails(event) {
      if (!event) return null;
      const known = [serverSummary?.strongest, serverSummary?.deadliest].find((s) => s?.rid === event.rid);
      return known ? { ...event, event_id: known.event_id, place: known.place } : event;
    },
  };
}
