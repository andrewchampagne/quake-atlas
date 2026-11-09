import { useState } from 'react';
import { formatCount, formatDepth, formatMagnitude } from '../lib/format';
import { formatDate } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';
import { YearChart } from './YearChart';

/** Total, strongest event and per-year chart for the current filters. */
export function SummaryPanel() {
  const summary = useQuakeStore((s) => s.summary);
  const summaryStatus = useQuakeStore((s) => s.summaryStatus);
  const summaryError = useQuakeStore((s) => s.summaryError);
  const filters = useQuakeStore((s) => s.filters);
  const downsampled = useQuakeStore((s) => s.events?.downsampled ?? false);
  const returned = useQuakeStore((s) => s.events?.returned ?? 0);
  const loadedTotal = useQuakeStore((s) => s.events?.total ?? 0);
  const minMagReturned = useQuakeStore((s) => s.events?.minMagReturned ?? null);
  const flyTo = useQuakeStore((s) => s.flyTo);
  const pin = useQuakeStore((s) => s.pin);
  const retry = useQuakeStore((s) => s.retry);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);

  if (!filters) return null;
  const refreshing = summaryStatus === 'loading' && summary !== null;
  const strongest = summary?.strongest ?? null;
  const noSources = filters.sources.length === 0;
  const total = noSources ? 0 : summary?.total;

  return (
    <section
      aria-label="Summary"
      className="panel pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden"
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
        <div className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Matching earthquakes</div>
          <div className="text-3xl leading-tight font-semibold tracking-tight">
            {total == null ? '—' : formatCount(total)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="summary-body"
          className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-raised hover:text-ink lg:hidden"
        >
          {open ? 'Less' : 'More'}
        </button>
      </header>

      {open && (
        <div id="summary-body" className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {summaryError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-ink">
              Couldn't load the summary: {summaryError}{' '}
              <button type="button" onClick={retry} className="text-accent underline">
                Retry
              </button>
            </div>
          )}

          {downsampled && !noSources && (
            <div className="flex gap-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs leading-snug text-ink">
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

          {strongest && !noSources && (
            <button
              type="button"
              onClick={() => {
                flyTo(strongest.longitude, strongest.latitude, 4.5);
                pin({
                  rid: strongest.rid,
                  longitude: strongest.longitude,
                  latitude: strongest.latitude,
                  magnitude: strongest.magnitude,
                });
              }}
              className={`group block w-full rounded-lg border border-line bg-raised/60 p-2.5 text-left hover:border-line-strong ${
                refreshing ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Strongest event
                <span className="font-normal normal-case tracking-normal text-accent opacity-80 group-hover:opacity-100">
                  Fly to it →
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold">{formatMagnitude(strongest.magnitude)}</div>
              <div className="text-sm text-ink">{strongest.place ?? 'Unnamed location'}</div>
              <div className="text-xs text-ink-2">
                {formatDate(strongest.time, strongest.source !== 'noaa')} · {formatDepth(strongest.depth_km)}
              </div>
            </button>
          )}

          {summary && !noSources && (
            <YearChart
              perYear={summary.per_year}
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
      )}
    </section>
  );
}
