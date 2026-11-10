import { useMemo, useState } from 'react';
import { formatDeathToll } from '../api/deaths';
import type { StrongestEvent } from '../api/types';
import { covers, summarizeEvents, toServerQuery } from '../lib/filters';
import { formatCount, formatDepth, formatMagnitude } from '../lib/format';
import { formatDate } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';
import { YearChart } from './YearChart';

/** Catalog totals, recorded deaths and notable events for the current filters/window. */
export function SummaryPanel() {
  const serverSummary = useQuakeStore((s) => s.summary);
  const summaryStatus = useQuakeStore((s) => s.summaryStatus);
  const summaryError = useQuakeStore((s) => s.summaryError);
  const filters = useQuakeStore((s) => s.filters);
  const meta = useQuakeStore((s) => s.meta);
  const events = useQuakeStore((s) => s.events);
  const playback = useQuakeStore((s) => s.playback);
  const downsampled = useQuakeStore((s) => s.events?.downsampled ?? false);
  const returned = useQuakeStore((s) => s.events?.returned ?? 0);
  const loadedTotal = useQuakeStore((s) => s.events?.total ?? 0);
  const minMagReturned = useQuakeStore((s) => s.events?.minMagReturned ?? null);
  const flyTo = useQuakeStore((s) => s.flyTo);
  const pin = useQuakeStore((s) => s.pin);
  const retry = useQuakeStore((s) => s.retry);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const localSummary = useMemo(() => {
    if (!events || !filters || !meta || events.downsampled ||
      !covers(events.query, toServerQuery(filters, meta))) return null;
    return summarizeEvents(events, filters, meta, playback);
  }, [events, filters, meta, playback]);
  const summary = localSummary ?? serverSummary;

  if (!filters) return null;
  const refreshing = !localSummary && summaryStatus === 'loading' && summary !== null;
  const withDetails = (event: StrongestEvent | null) => {
    if (!event) return null;
    const known = [serverSummary?.strongest, serverSummary?.deadliest].find((s) => s?.rid === event.rid);
    return known ? { ...event, event_id: known.event_id, place: known.place } : event;
  };
  const strongest = withDetails(summary?.strongest ?? null);
  const deadliest = withDetails(summary?.deadliest ?? null);
  const noSources = filters.sources.length === 0;
  const total = noSources ? 0 : summary?.total;

  return (
    <section
      aria-label="Summary"
      className="panel pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden"
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
        <div className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="eyebrow">
            {localSummary && playback.windowEnabled ? 'Earthquakes in time window' : 'Matching earthquakes'}
          </div>
          <div className="text-3xl leading-tight font-semibold tracking-tight">
            {total == null ? '—' : formatCount(total)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="summary-body"
          className="btn btn-ghost btn-sm lg:hidden"
        >
          {open ? 'Less' : 'More'}
        </button>
      </header>

      <div id="summary-body" className={`${open ? "block" : "hidden"} min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 lg:block`}>
          {summaryError && (
            <div className="callout callout-danger block">
              Couldn't load the summary: {summaryError}{' '}
              <button type="button" onClick={retry} className="link">
                Retry
              </button>
            </div>
          )}

          <div className={refreshing ? 'space-y-1 opacity-60' : 'space-y-1'}>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line p-2.5 text-xs">
              <div>
                <dt className="text-ink-3">Recorded deaths (exact counts)</dt>
                <dd className="tnum mt-1 text-xl font-semibold text-ink">
                  {noSources ? '0' : summary?.total_deaths == null ? '—' : formatCount(summary.total_deaths)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Events with recorded deaths</dt>
                <dd className="tnum mt-1 text-xl font-semibold text-ink">
                  {noSources ? '0' : summary?.deadly_events == null ? '—' : formatCount(summary.deadly_events)}
                </dd>
              </div>
            </dl>
            <p className="text-[10px] leading-snug text-ink-3">
              Exact totals exclude unknown tolls and approximate ranges. Missing reports do not mean zero deaths.
              {!noSources && summary?.approx_deadly_events != null && summary.approx_deadly_events > 0 && (
                <> {formatCount(summary.approx_deadly_events)} events have approximate ranges only.</>
              )}
            </p>
            {playback.windowEnabled && !localSummary && (
              <p className="text-[10px] text-ink-3">Statistics cover the full filter period, including events outside the time window.</p>
            )}
          </div>

          {downsampled && !noSources && (
            <div className="callout callout-warn">
              <span aria-hidden="true" className="text-warn">
                ▲
              </span>
              <span>
                <strong className="font-semibold">Downsampled.</strong> The map shows the {formatCount(returned)}{' '}
                strongest of {formatCount(loadedTotal)} matching events
                {minMagReturned != null && <> (M {minMagReturned.toFixed(1)} and up)</>}. Narrow the filters to see
                smaller ones.
              </span>
            </div>
          )}

          {!noSources && [
            { title: 'Strongest event', event: strongest, deathFirst: false },
            { title: 'Deadliest recorded event', event: deadliest, deathFirst: true },
          ].map(({ title, event, deathFirst }) => event && (
            <button
              key={title}
              type="button"
              onClick={() => {
                flyTo(event.longitude, event.latitude, 4.5);
                pin({
                  rid: event.rid,
                  longitude: event.longitude,
                  latitude: event.latitude,
                  magnitude: event.magnitude,
                });
              }}
              className={`group block w-full rounded-lg border border-line bg-raised/60 p-2.5 text-left hover:border-line-strong ${
                refreshing ? 'opacity-60' : ''
              }`}
            >
              <div className="eyebrow flex items-center justify-between">
                {title}
                <span className="font-normal normal-case tracking-normal text-ink-2 underline decoration-ink-3 underline-offset-2 group-hover:text-ink">
                  Fly to it →
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold">
                {deathFirst ? `${formatDeathToll(event)} deaths` : formatMagnitude(event.magnitude)}
              </div>
              <div className="text-sm text-ink">{event.place ?? (event.event_id ? 'Unnamed location' : 'Pin for location details')}</div>
              <div className="text-xs text-ink-2">
                {formatDate(event.time, event.source !== 'noaa')} · {formatDepth(event.depth_km)}
              </div>
              <div className="mt-1 text-xs text-ink-2">
                {deathFirst ? formatMagnitude(event.magnitude) : `Recorded deaths: ${formatDeathToll(event)}`}
              </div>
            </button>
          ))}

          {summary && !noSources && (
            <YearChart
              perYear={serverSummary?.per_year ?? summary.per_year}
              startYear={filters.yearRange[0]}
              endYear={filters.yearRange[1]}
              dimmed={refreshing}
            />
          )}

          {!summary && summaryStatus === 'loading' && <p className="text-xs text-ink-3">Loading summary…</p>}
          {summary?.total === 0 && !noSources && (
            <p className="text-xs text-ink-2">No earthquakes match these filters. Try widening them.</p>
          )}
      </div>
    </section>
  );
}
