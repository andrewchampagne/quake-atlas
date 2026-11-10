import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { YearCount } from '../api/types';
import { binCounts, chooseBinSize, type Bin } from '../lib/bins';
import { ERAS } from '../lib/eras';
import { formatCompact, formatCount } from '../lib/format';
import { formatYear } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';

// Single series: neutral ink (colour is reserved for data encodings on the map).
const BAR_COLOR = '#a9a69d';
const GRID_COLOR = '#2c2c30';
const AXIS_TEXT = '#77777d';

interface YearChartProps {
  perYear: YearCount[];
  startYear: number;
  endYear: number;
  dimmed?: boolean;
}

interface EraBand {
  id: string;
  label: string;
  x1: number;
  x2: number;
  shaded: boolean;
  showLabel: boolean;
}

function eraBands(bins: Bin[]): EraBand[] {
  if (bins.length === 0) return [];
  const bands: EraBand[] = [];
  ERAS.forEach((era, i) => {
    const inside = bins.filter((b) => b.start >= era.start && b.start < era.end);
    if (inside.length === 0) return;
    bands.push({
      id: era.id,
      label: era.label,
      x1: inside[0].start,
      x2: inside.at(-1)!.start,
      shaded: i % 2 === 1,
      showLabel: inside.length / bins.length >= 0.22,
    });
  });
  return bands.length > 1 ? bands : [];
}

function BinTooltip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const bin = payload[0].payload as Bin;
  const era = ERAS.find((e) => bin.start >= e.start && bin.start < e.end);
  return (
    <div className="rounded-lg border border-line bg-panel-solid px-2.5 py-1.5 text-xs shadow-xl">
      <div className="tnum text-sm font-semibold text-ink">{formatCount(bin.count)} events</div>
      <div className="text-ink-2">{bin.label}</div>
      {era && <div className="text-ink-3">{era.label} era</div>}
      <div className="mt-0.5 text-[10px] text-ink-3">Click to show this period on the map</div>
    </div>
  );
}

/** Events per year (or per N years for long ranges). Clicking a bar focuses that period. */
export function YearChart({ perYear, startYear, endYear, dimmed }: YearChartProps) {
  const focusPeriod = useQuakeStore((s) => s.focusPeriod);
  // Narrow selectors: re-render only when the window crosses a whole year.
  const windowEnabled = useQuakeStore((s) => s.playback.windowEnabled);
  const windowYear = useQuakeStore((s) => Math.floor(s.playback.windowStart));
  const windowSize = useQuakeStore((s) => s.playback.windowSize);
  const mode = useQuakeStore((s) => s.playback.mode);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const binSize = chooseBinSize(startYear, endYear);
  const bins = useMemo(() => binCounts(perYear, startYear, endYear, binSize), [perYear, startYear, endYear, binSize]);
  const bands = useMemo(() => eraBands(bins), [bins]);

  const winStart = mode === 'cumulative' ? startYear : windowYear;
  const winEnd = windowYear + windowSize;
  const inWindow = (b: Bin) => !windowEnabled || (b.end > winStart && b.start < winEnd);
  const unit = binSize === 1 ? 'year' : `${binSize} years`;

  return (
    <div className={dimmed ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="eyebrow">Events per {unit}</h3>
        <div className="seg" role="group" aria-label="Chart view">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="capitalize"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'chart' ? (
        <div className="h-40" role="img" aria-label={`Bar chart of earthquake counts per ${unit}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bins} margin={{ top: 14, right: 4, bottom: 0, left: -8 }} barCategoryGap={1}>
              {bands.map((band) => (
                <ReferenceArea
                  key={band.id}
                  x1={band.x1}
                  x2={band.x2}
                  fill="#ffffff"
                  fillOpacity={band.shaded ? 0.05 : 0}
                  stroke="none"
                  ifOverflow="hidden"
                  label={
                    band.showLabel
                      ? { value: band.label, position: 'insideTop', fill: AXIS_TEXT, fontSize: 9, dy: -12 }
                      : undefined
                  }
                />
              ))}
              <CartesianGrid vertical={false} stroke={GRID_COLOR} />
              <XAxis
                dataKey="start"
                tickFormatter={(v: number) => formatYear(v)}
                tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                axisLine={{ stroke: GRID_COLOR }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v: number) => formatCompact(v)}
                tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={40}
              />
              <Tooltip
                content={(props) => <BinTooltip {...(props as TooltipContentProps<number, string>)} />}
                cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                isAnimationActive={false}
              />
              <Bar
                dataKey="count"
                maxBarSize={24}
                radius={binSize >= 1 && bins.length <= 60 ? [3, 3, 0, 0] : [1, 1, 0, 0]}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(entry) => {
                  const bin = (entry as unknown as { payload?: Bin }).payload;
                  if (bin) focusPeriod(bin.start, bin.end);
                }}
              >
                {bins.map((b) => (
                  <Cell key={b.start} fill={BAR_COLOR} fillOpacity={inWindow(b) ? 1 : 0.3} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-40 overflow-y-auto rounded-md border border-line">
          <table className="tnum w-full text-xs">
            <thead className="sticky top-0 bg-panel-solid text-ink-3">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Period</th>
                <th className="px-2 py-1 text-right font-medium">Events</th>
              </tr>
            </thead>
            <tbody>
              {bins
                .filter((b) => b.count > 0)
                .map((b) => (
                  <tr
                    key={b.start}
                    className="cursor-pointer border-t border-line hover:bg-raised"
                    onClick={() => focusPeriod(b.start, b.end)}
                  >
                    <td className="px-2 py-1 text-ink-2">{b.label}</td>
                    <td className="px-2 py-1 text-right text-ink">{formatCount(b.count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {bands.length > 0 && view === 'chart' && (
        <p className="mt-1 text-[10px] text-ink-3">Shaded bands mark catalog eras with different completeness.</p>
      )}
    </div>
  );
}
