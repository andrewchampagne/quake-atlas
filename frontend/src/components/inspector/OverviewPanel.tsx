import { useEffect, useMemo } from 'react';
import { formatDeathToll } from '../../api/deaths';
import type { StrongestEvent } from '../../api/types';
import { binCounts, chooseBinSize } from '../../lib/bins';
import { formatCount, formatMagnitude } from '../../lib/format';
import { formatDate } from '../../lib/time';
import { useQuakeStore } from '../../store/useQuakeStore';
import { useOverviewSummary } from './useOverviewSummary';

function NotableEvent({ title, event, headline, detail }: { title: string; event: StrongestEvent; headline: string; detail: string }) {
  const select = useQuakeStore((s) => s.pin);
  const flyTo = useQuakeStore((s) => s.flyTo);
  return (
    <button
      type="button"
      className="group block w-full rounded-lg border border-line bg-raised/50 px-3 py-2 text-left hover:border-line-strong hover:bg-raised"
      onClick={() => {
        select({ rid: event.rid, longitude: event.longitude, latitude: event.latitude, magnitude: event.magnitude });
        flyTo(event.longitude, event.latitude, 4.5);
      }}
    >
      <div className="eyebrow">{title}</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-base font-semibold text-ink">{headline}</span>
        <span className="shrink-0 text-[11px] text-ink-3 group-hover:text-ink">View →</span>
      </div>
      <div className="truncate text-xs text-ink-2">{event.place ?? (event.event_id ? 'Unnamed location' : 'Select for location')}</div>
      <div className="text-[11px] text-ink-3">
        {formatDate(event.time, event.source !== 'noaa')} · {detail}
      </div>
    </button>
  );
}

function LargestFamilies() {
  const stats = useQuakeStore((s) => s.familyStats);
  const loadFamilyStats = useQuakeStore((s) => s.loadFamilyStats);
  const pin = useQuakeStore((s) => s.pin);
  const flyTo = useQuakeStore((s) => s.flyTo);
  const setTab = useQuakeStore((s) => s.setInspectorTab);
  useEffect(() => {
    void loadFamilyStats();
  }, [loadFamilyStats]);
  if (!stats || stats.largest.length === 0) return null;
  return (
    <section>
      <h3 className="eyebrow mb-1">Largest earthquake families</h3>
      <ul className="-mx-1.5">
        {stats.largest.slice(0, 5).map((f) => (
          <li key={f.mainshock.rid}>
            <button
              type="button"
              className="group flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-raised"
              onClick={() => {
                const m = f.mainshock;
                pin({ rid: m.rid, longitude: m.longitude, latitude: m.latitude, magnitude: m.magnitude });
                setTab('family');
                flyTo(m.longitude, m.latitude, 4);
              }}
            >
              <span className="tnum shrink-0 font-semibold text-ink">M {f.mainshock.magnitude.toFixed(1)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2 group-hover:text-ink">{f.mainshock.place ?? 'Unnamed location'}</span>
              <span className="tnum shrink-0 text-ink-3">{formatCount(f.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ink-3">Mainshocks with the most linked foreshocks and aftershocks.</p>
    </section>
  );
}

function PeriodTable() {
  const perYear = useQuakeStore((s) => s.summary?.per_year);
  const filters = useQuakeStore((s) => s.filters);
  const focusPeriod = useQuakeStore((s) => s.focusPeriod);
  const rows = useMemo(() => {
    if (!perYear || !filters) return [];
    const [y0, y1] = filters.yearRange;
    return binCounts(perYear, y0, y1, chooseBinSize(y0, y1, 60)).filter((b) => b.count > 0);
  }, [perYear, filters]);
  if (rows.length === 0) return null;
  return (
    <details className="group rounded-lg border border-line text-xs">
      <summary className="cursor-pointer list-none px-3 py-2 text-ink-2 hover:text-ink">
        <span className="mr-1 inline-block text-ink-3 transition-transform group-open:rotate-90">▸</span>
        Events by period
      </summary>
      <div className="max-h-48 overflow-y-auto border-t border-line">
        <table className="tnum w-full">
          <thead className="sticky top-0 bg-panel-solid text-ink-3">
            <tr>
              <th className="px-3 py-1 text-left font-medium">Period</th>
              <th className="px-3 py-1 text-right font-medium">Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.start} className="cursor-pointer border-t border-line hover:bg-raised" onClick={() => focusPeriod(b.start, b.end)}>
                <td className="px-3 py-1 text-ink-2">{b.label}</td>
                <td className="px-3 py-1 text-right text-ink">{formatCount(b.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** What the map shows right now: totals, deaths, notable events and the biggest families. */
export function OverviewPanel() {
  const { summary, windowed, windowUnavailable, refreshing, withDetails } = useOverviewSummary();
  const summaryStatus = useQuakeStore((s) => s.summaryStatus);
  const summaryError = useQuakeStore((s) => s.summaryError);
  const retry = useQuakeStore((s) => s.retry);
  const familiesReady = useQuakeStore((s) => s.meta?.families_ready ?? false);
  const downsampled = useQuakeStore((s) => s.events?.downsampled ?? false);
  const returned = useQuakeStore((s) => s.events?.returned ?? 0);
  const loadedTotal = useQuakeStore((s) => s.events?.total ?? 0);
  const minMagReturned = useQuakeStore((s) => s.events?.minMagReturned ?? null);
  const strongest = withDetails(summary?.strongest);
  const deadliest = withDetails(summary?.deadliest);

  return (
    <div className="space-y-4">
      <header className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <div className="eyebrow">{windowed ? 'Earthquakes in this window' : 'Earthquakes shown'}</div>
        <div className="tnum text-3xl leading-tight font-semibold tracking-tight">{summary ? formatCount(summary.total) : '—'}</div>
        <p className="text-xs text-ink-3">Click any point on the map for its details and family.</p>
      </header>

      {summaryError && (
        <div className="callout callout-danger block">
          Couldn't load the summary: {summaryError}{' '}
          <button type="button" onClick={retry} className="link">
            Retry
          </button>
        </div>
      )}
      {downsampled && (
        <div className="callout callout-warn">
          <span aria-hidden="true" className="text-warn">
            ▲
          </span>
          <span>
            Showing the {formatCount(returned)} strongest of {formatCount(loadedTotal)}
            {minMagReturned != null && <> (M {minMagReturned.toFixed(1)}+)</>}. Narrow the filters to see smaller ones.
          </span>
        </div>
      )}

      {summary && summary.total > 0 && (
        <>
          <section className={refreshing ? 'opacity-60' : undefined}>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-ink-3">Recorded deaths</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-ink">
                  {summary.total_deaths == null ? '—' : formatCount(summary.total_deaths)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Deadly events</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold text-ink">
                  {summary.deadly_events == null ? '—' : formatCount(summary.deadly_events)}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-[11px] leading-snug text-ink-3" title="Unknown tolls and approximate NOAA ranges are not added to the total.">
              Exact counts only; missing reports don't mean zero.
              {summary.approx_deadly_events ? <> {formatCount(summary.approx_deadly_events)} more have only approximate tolls.</> : null}
            </p>
            {windowUnavailable && <p className="mt-1 text-[11px] text-ink-3">Totals cover the whole range, not just the window.</p>}
          </section>

          <section className="space-y-2">
            {strongest && (
              <NotableEvent
                title="Strongest"
                event={strongest}
                headline={formatMagnitude(strongest.magnitude)}
                detail={`Deaths: ${formatDeathToll(strongest)}`}
              />
            )}
            {deadliest && (
              <NotableEvent
                title="Deadliest recorded"
                event={deadliest}
                headline={`${formatDeathToll(deadliest)} deaths`}
                detail={formatMagnitude(deadliest.magnitude)}
              />
            )}
          </section>
        </>
      )}

      {summary?.total === 0 && <p className="text-xs text-ink-2">No earthquakes match. Widen the filters or the date range.</p>}
      {!summary && summaryStatus === 'loading' && <p className="text-xs text-ink-3">Loading…</p>}

      {familiesReady && <LargestFamilies />}
      <PeriodTable />
    </div>
  );
}
