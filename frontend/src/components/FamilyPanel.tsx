import { useEffect, useState } from 'react';
import type { Family, FamilyStats } from '../api/types';
import { formatLogEta, plural, ROLE_LABELS } from '../lib/family';
import { formatCount, formatDepth } from '../lib/format';
import { formatDate } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';
import { AftershockForecast } from './AftershockForecast';
import { FamilyTree } from './FamilyTree';
import { ProximityPlot } from './ProximityPlot';

const BAR = '#a9a69d';
const MAX_GENERATION_ROWS = 8;

/** Why the pinned event has (or lacks) a parent, in plain words. */
function linkExplanation(family: Family): string | null {
  const nn = family.neighbour;
  if (!nn) return null;
  const th = formatLogEta(nn.threshold);
  if (nn.linked) {
    return `Its nearest earlier neighbour is close enough in time, distance and magnitude to be its parent: log₁₀ η = ${formatLogEta(nn.log_eta)}, below the threshold of ${th}.`;
  }
  const starts = family.size > 1 ? 'so it is the first event of this family' : 'so it stands alone';
  if (nn.log_eta == null) return `No earlier event comes anywhere near the threshold of ${th}, ${starts}.`;
  return `Its nearest earlier neighbour is too far away to be its parent (log₁₀ η = ${formatLogEta(nn.log_eta)}, threshold ${th}), ${starts}.`;
}

function Generations({ family }: { family: Family }) {
  const [all, setAll] = useState(false);
  const rows = all ? family.generations : family.generations.slice(0, MAX_GENERATION_ROWS);
  const max = Math.max(...family.generations.map((g) => g.count));
  return (
    <div>
      <h3 className="eyebrow mb-1">Generations</h3>
      <table className="tnum w-full text-[11px]">
        <tbody>
          {rows.map((g) => (
            <tr key={g.generation}>
              <td className="w-10 py-0.5 pr-2 text-ink-3">{g.generation === 0 ? 'Root' : `+${g.generation}`}</td>
              <td className="py-0.5">
                <div className="h-2 rounded-r-sm" style={{ width: `${Math.max(2, (g.count / max) * 100)}%`, background: BAR }} />
              </td>
              <td className="w-12 py-0.5 pl-2 text-right text-ink">{formatCount(g.count)}</td>
              <td className="w-14 py-0.5 pl-2 text-right text-ink-3">max {g.max_magnitude.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {family.generations.length > MAX_GENERATION_ROWS && (
        <button type="button" className="link mt-0.5 text-[11px]" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${family.generations.length} generations`}
        </button>
      )}
      <p className="mt-1 text-[10px] leading-snug text-ink-3">
        Each generation is one link further from the family's first event. Aftershocks trigger their own aftershocks, so
        the mainshock is rarely the root.
      </p>
    </div>
  );
}

function Method({ stats }: { stats: FamilyStats | null }) {
  return (
    <details className="group rounded-lg border border-line p-2.5 text-xs">
      <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
        <span className="mr-1 inline-block text-ink-3 transition-transform group-open:rotate-90">▸</span>
        How families are found
      </summary>
      <div className="mt-2 space-y-2 leading-snug text-ink-2">
        <p>
          Every earthquake gets one candidate parent: the earlier event closest to it in a combined measure of time,
          distance and the earlier event's magnitude, η = t · r<sup>{stats?.fractal_dimension ?? 1.6}</sup> · 10
          <sup>−{stats?.b_value ?? 1}·m</sup> (Zaliapin &amp; Ben-Zion 2013). Bigger earthquakes reach further.
        </p>
        <p>
          The proximities fall into two groups: aftershock-like pairs, orders of magnitude closer than chance, and
          independent background events. A Gaussian mixture places the threshold between them. Links below it join
          events into families; the largest event in each family is its mainshock.
        </p>
        {stats && (
          <>
            <ProximityPlot stats={stats} />
            <p className="tnum text-[11px]">
              {formatCount(stats.analysed)} instrumental events: {(stats.clustered_fraction * 100).toFixed(0)}% are
              foreshocks or aftershocks, in {formatCount(stats.families)} families. Threshold log₁₀ η ={' '}
              {formatLogEta(stats.threshold)}
              {stats.threshold_method === 'default' ? ' (default; the data showed no clear split)' : ''}.
            </p>
          </>
        )}
        <p className="text-[10px] text-ink-3">
          Families depend on the catalog: events below its magnitude floor are missing, so small links are invisible and
          sparse regions look more independent. NOAA's historical records are not clustered.
        </p>
      </div>
    </details>
  );
}

/** Right-column panel for the pinned event's family: summary, tree, forecast and method. */
export function FamilyPanel() {
  const family = useQuakeStore((s) => s.family);
  const status = useQuakeStore((s) => s.familyStatus);
  const error = useQuakeStore((s) => s.familyError);
  const pinned = useQuakeStore((s) => s.pinned);
  const stats = useQuakeStore((s) => s.familyStats);
  const loadFamilyStats = useQuakeStore((s) => s.loadFamilyStats);
  const pin = useQuakeStore((s) => s.pin);
  const flyTo = useQuakeStore((s) => s.flyTo);
  const close = useQuakeStore((s) => s.setFamilyPanelOpen);

  useEffect(() => {
    void loadFamilyStats();
  }, [loadFamilyStats]);

  const current = family && pinned && family.members.rid.includes(pinned.rid) ? family : null;
  const exact = current && current.rid === pinned?.rid;
  const main = current?.mainshock;
  const select = (i: number) => {
    if (!current) return;
    const m = current.members;
    pin({ rid: m.rid[i], longitude: m.longitude[i], latitude: m.latitude[i], magnitude: m.magnitude[i] });
    flyTo(m.longitude[i], m.latitude[i], 4);
  };

  return (
    <section aria-label="Earthquake family" className="panel pointer-events-auto flex min-h-0 w-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <div className="eyebrow">Earthquake family</div>
          {main ? (
            <>
              <div className="text-lg leading-tight font-semibold">M {main.magnitude.toFixed(1)} mainshock</div>
              <div className="truncate text-sm text-ink-2">{main.place ?? 'Unnamed location'}</div>
            </>
          ) : (
            <div className="text-lg font-semibold">{current ? ROLE_LABELS[current.role] : 'Loading…'}</div>
          )}
        </div>
        <button type="button" onClick={() => close(false)} className="btn btn-ghost btn-sm shrink-0" aria-label="Close family panel and show the summary">
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {status === 'error' && <div className="callout callout-danger block">Couldn't load the family: {error}</div>}
        {!current && status === 'loading' && <p className="text-xs text-ink-3">Loading family…</p>}

        {current && (
          <>
            {current.size > 1 && current.start_time != null && current.end_time != null && (
              <>
                <dl className="tnum grid grid-cols-3 gap-2 rounded-lg border border-line p-2.5 text-xs">
                  <div>
                    <dt className="text-ink-3">Events</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-ink">{formatCount(current.size)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Foreshocks</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-ink">{formatCount(current.foreshocks)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Aftershocks</dt>
                    <dd className="mt-0.5 text-lg font-semibold text-ink">{formatCount(current.aftershocks)}</dd>
                  </div>
                </dl>
                <p className="tnum -mt-1 text-[11px] text-ink-2">
                  {formatDate(current.start_time, true)} – {formatDate(current.end_time, true)}
                  {main && <> · mainshock {formatDate(main.time)} at {formatDepth(main.depth_km)}</>}
                </p>
              </>
            )}

            {exact && (
              <div className="rounded-lg border border-line bg-raised/60 p-2.5 text-xs">
                <div className="eyebrow">Pinned event</div>
                <div className="mt-0.5 text-sm text-ink">
                  {ROLE_LABELS[current.role]}
                  {current.size > 1 && (
                    <span className="text-ink-2">
                      {' '}
                      · generation {current.members.generation[current.members.rid.indexOf(current.rid)]}
                    </span>
                  )}
                </div>
                {linkExplanation(current) && <p className="mt-1 leading-snug text-ink-2">{linkExplanation(current)}</p>}
                {current.role === 'unclassified' && (
                  <p className="mt-1 leading-snug text-ink-2">
                    Historical (NOAA) records are too sparse, and their times and places too uncertain, to link into
                    families.
                  </p>
                )}
              </div>
            )}

            {current.size > 1 && <Generations family={current} />}

            {current.size > 1 && pinned && (
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="eyebrow">Family tree</h3>
                  <span className="text-[10px] text-ink-3">+N = descendants</span>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-line p-1.5">
                  <FamilyTree key={current.cluster_id ?? current.rid} family={current} pinnedRid={pinned.rid} onSelect={select} />
                </div>
                <p className="mt-1 text-[10px] leading-snug text-ink-3">
                  Click an event to pin it. Lines on the map join each event to its parent; the bright chain leads from
                  the first event to the pinned one.
                  {current.truncated && ` Only the ${plural(current.members.rid.length, 'strongest event')} are listed.`}
                </p>
              </div>
            )}

            {current.forecast_eligible && main && (
              <div>
                <h3 className="eyebrow mb-1">Aftershock forecast (retrospective)</h3>
                <p className="mb-2 text-[11px] leading-snug text-ink-2">
                  Fit the Omori–Utsu decay law to the first days of the sequence, then compare its forecast with what the
                  catalog recorded afterwards.
                </p>
                <AftershockForecast mainshockRid={main.rid} />
              </div>
            )}
          </>
        )}

        <Method stats={stats} />
      </div>
    </section>
  );
}
