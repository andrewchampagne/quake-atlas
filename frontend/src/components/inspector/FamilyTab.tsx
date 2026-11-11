import { useEffect, useState } from 'react';
import type { Family, FamilyStats } from '../../api/types';
import { formatLogEta, linkExplanation, plural } from '../../lib/family';
import { formatCount } from '../../lib/format';
import { formatDate } from '../../lib/time';
import { useQuakeStore } from '../../store/useQuakeStore';
import { FamilyTree } from '../FamilyTree';
import { ProximityPlot } from '../ProximityPlot';

const BAR = '#a9a69d';
const MAX_GENERATION_ROWS = 6;

function Generations({ family }: { family: Family }) {
  const [all, setAll] = useState(false);
  const rows = all ? family.generations : family.generations.slice(0, MAX_GENERATION_ROWS);
  const max = Math.max(...family.generations.map((g) => g.count));
  return (
    <section>
      <h3 className="eyebrow mb-1" title="Each generation is one link further from the family's first event.">
        Generations
      </h3>
      <table className="tnum w-full text-[11px]">
        <tbody>
          {rows.map((g) => (
            <tr key={g.generation}>
              <td className="w-10 py-0.5 pr-2 text-ink-3">{g.generation === 0 ? 'First' : `+${g.generation}`}</td>
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
    </section>
  );
}

function Method({ stats }: { stats: FamilyStats | null }) {
  return (
    <details className="group rounded-lg border border-line text-xs">
      <summary className="cursor-pointer list-none px-3 py-2 text-ink-2 hover:text-ink">
        <span className="mr-1 inline-block text-ink-3 transition-transform group-open:rotate-90">▸</span>
        How families are found
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2.5 leading-snug text-ink-2">
        <p>
          Each earthquake gets one candidate parent: the earlier event closest to it in a mix of time, distance and the
          earlier event's magnitude (η = t · r<sup>{stats?.fractal_dimension ?? 1.6}</sup> · 10<sup>−m</sup>; Zaliapin &amp;
          Ben-Zion 2013). Bigger earthquakes reach further.
        </p>
        <p>
          Triggered pairs sit orders of magnitude closer than independent ones. A threshold between the two groups links
          events into families; the largest event in each is its mainshock.
        </p>
        {stats && (
          <>
            <ProximityPlot stats={stats} />
            <p className="tnum text-[11px]">
              {formatCount(stats.analysed)} instrumental events: {(stats.clustered_fraction * 100).toFixed(0)}% are foreshocks
              or aftershocks, in {formatCount(stats.families)} families (threshold log₁₀ η = {formatLogEta(stats.threshold)}).
            </p>
          </>
        )}
        <p className="text-[10px] text-ink-3">
          Events below the catalog's magnitude floor are missing, so sparse regions look more independent. Historical NOAA
          records are not grouped.
        </p>
      </div>
    </details>
  );
}

/** The selected event's family: counts, how it links, generations, the tree and the method. */
export function FamilyTab({ family, pinnedRid }: { family: Family; pinnedRid: number }) {
  const stats = useQuakeStore((s) => s.familyStats);
  const loadFamilyStats = useQuakeStore((s) => s.loadFamilyStats);
  const pin = useQuakeStore((s) => s.pin);
  const flyTo = useQuakeStore((s) => s.flyTo);
  useEffect(() => {
    void loadFamilyStats();
  }, [loadFamilyStats]);

  const select = (i: number) => {
    const m = family.members;
    pin({ rid: m.rid[i], longitude: m.longitude[i], latitude: m.latitude[i], magnitude: m.magnitude[i] });
    flyTo(m.longitude[i], m.latitude[i], 4);
  };
  const exact = family.rid === pinnedRid;

  return (
    <div className="space-y-4">
      <section>
        <dl className="tnum grid grid-cols-3 gap-2 text-xs">
          {[
            ['Events', family.size],
            ['Foreshocks', family.foreshocks],
            ['Aftershocks', family.aftershocks],
          ].map(([label, n]) => (
            <div key={label}>
              <dt className="text-ink-3">{label}</dt>
              <dd className="mt-0.5 text-lg font-semibold text-ink">{formatCount(n as number)}</dd>
            </div>
          ))}
        </dl>
        {family.start_time != null && family.end_time != null && (
          <p className="tnum mt-1 text-[11px] text-ink-3">
            {formatDate(family.start_time, false)} – {formatDate(family.end_time, false)}
          </p>
        )}
        {exact && linkExplanation(family) && <p className="mt-2 text-xs leading-snug text-ink-2">{linkExplanation(family)}</p>}
      </section>

      <Generations family={family} />

      <section>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="eyebrow">Family tree</h3>
          <span className="text-[10px] text-ink-3">+N = descendants</span>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line p-1.5">
          <FamilyTree key={family.cluster_id ?? family.rid} family={family} pinnedRid={pinnedRid} onSelect={select} />
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-3">
          Click an event to select it. On the map, lines join each event to its parent; the bright chain leads to the
          selected one.
          {family.truncated && ` Only the ${plural(family.members.rid.length, 'strongest event')} are listed.`}
        </p>
      </section>

      <Method stats={stats} />
    </div>
  );
}
