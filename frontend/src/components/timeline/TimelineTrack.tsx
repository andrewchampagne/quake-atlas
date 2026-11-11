import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ERAS } from '../../lib/eras';
import { visibleWindow } from '../../lib/filters';
import { formatCount } from '../../lib/format';
import { formatPeriod, formatYear } from '../../lib/time';
import { binHeight, layoutTicks, timelineBins, type TimelineBin } from '../../lib/timelineBins';
import { makeYearScale } from '../../lib/yearScale';
import { useQuakeStore } from '../../store/useQuakeStore';

const RES = 1000;
const HEIGHT = 44;
const TICK_YEARS = [1000, 1900, 1950, 2000];
/** Neutral marks from the design tokens; colour stays reserved for the map's depth encoding. */
const BAR_OUT = '#3d3d39';
const BAR_IN = '#a9a69d';
const BAR_WINDOW = '#ecebe7';

function binAt(bins: TimelineBin[], pos: number): TimelineBin | undefined {
  return bins.find((b) => pos >= b.p0 && pos < b.p1) ?? bins.at(-1);
}

/**
 * The timeline's track: events per year over the whole catalog (on a stretched
 * year scale), the selected date range between two handles, and the playback
 * window as a box you can drag. Clicking a bar shows that period.
 */
export function TimelineTrack() {
  const meta = useQuakeStore((s) => s.meta)!;
  const filters = useQuakeStore((s) => s.filters)!;
  const playback = useQuakeStore((s) => s.playback);
  const perYear = useQuakeStore((s) => s.timelineSummary?.per_year);
  const setFilters = useQuakeStore((s) => s.setFilters);
  const setPlayback = useQuakeStore((s) => s.setPlayback);
  const focusPeriod = useQuakeStore((s) => s.focusPeriod);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hovered, setHovered] = useState<TimelineBin | null>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const end = meta.max_year + 1;
  const scale = useMemo(() => makeYearScale(meta.min_year, end), [meta.min_year, end]);
  const bins = useMemo(() => timelineBins(perYear ?? [], scale, meta.min_year, end), [perYear, scale, meta.min_year, end]);
  const maxRate = useMemo(() => Math.max(0, ...bins.map((b) => b.rate)), [bins]);

  const [y0, y1] = filters.yearRange;
  const [w0, w1] = visibleWindow(filters, playback);
  const sel0 = scale.toPos(y0);
  const sel1 = scale.toPos(y1 + 1);
  const win0 = scale.toPos(w0);
  const win1 = scale.toPos(w1);

  const posAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  };

  const moveWindow = (clientX: number) => {
    const center = scale.toDecimalYear(posAt(clientX));
    setPlayback({ windowEnabled: true, playing: false, windowStart: center - playback.windowSize / 2 });
  };

  const onWindowPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onWindowPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveWindow(e.clientX);
  };
  const onWindowPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const ticks = layoutTicks(
    [
      { year: meta.min_year, pos: 0, align: 'start' },
      ...TICK_YEARS.filter((y) => y > meta.min_year && y < meta.max_year).map((y) => ({
        year: y,
        pos: scale.toPos(y),
        align: 'center' as const,
      })),
      { year: meta.max_year, pos: 1, align: 'end' },
    ],
    width,
  );

  const fill = (b: TimelineBin) => {
    const inRange = b.end > y0 && b.start <= y1;
    if (!inRange) return BAR_OUT;
    if (playback.windowEnabled && b.end > w0 && b.start < w1) return BAR_WINDOW;
    return BAR_IN;
  };
  const windowLabel = formatPeriod(w0, w1);

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        className="relative cursor-pointer"
        style={{ height: HEIGHT }}
        role="group"
        aria-label="Timeline of events per year. Drag the handles to set the date range; click a bar to show that period."
        onPointerMove={(e) => setHovered(binAt(bins, posAt(e.clientX)) ?? null)}
        onPointerLeave={() => setHovered(null)}
        onClick={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          const bin = binAt(bins, posAt(e.clientX));
          if (bin) focusPeriod(Math.max(bin.start, y0), Math.min(bin.end, y1 + 1));
        }}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${RES} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {ERAS.map((era, i) =>
            i % 2 === 1 ? (
              <rect
                key={era.id}
                x={scale.toPos(Math.max(era.start, meta.min_year)) * RES}
                width={(scale.toPos(Math.min(era.end, end)) - scale.toPos(Math.max(era.start, meta.min_year))) * RES}
                y={0}
                height={HEIGHT}
                fill="#ffffff"
                fillOpacity={0.035}
              />
            ) : null,
          )}
          {bins.map((b) => {
            const h = binHeight(b, maxRate) * (HEIGHT - 6);
            const w = (b.p1 - b.p0) * RES;
            return h > 0 ? (
              <rect
                key={b.start}
                x={b.p0 * RES + Math.min(0.5, w * 0.15)}
                width={Math.max(0.8, w - Math.min(1, w * 0.3))}
                y={HEIGHT - h}
                height={h}
                fill={fill(b)}
                fillOpacity={hovered?.start === b.start ? 1 : 0.9}
              />
            ) : null;
          })}
          {/* Dim what lies outside the selected range. */}
          <rect x={0} width={sel0 * RES} y={0} height={HEIGHT} fill="#0f0f0e" fillOpacity={0.45} />
          <rect x={sel1 * RES} width={(1 - sel1) * RES} y={0} height={HEIGHT} fill="#0f0f0e" fillOpacity={0.45} />
          <line x1={0} x2={RES} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke="#3d3d39" />
        </svg>

        {playback.windowEnabled && (
          <div
            className="timeline-window"
            style={{ left: `${win0 * 100}%`, width: `max(6px, ${(win1 - win0) * 100}%)` }}
            title={`${windowLabel}: drag to move`}
            aria-hidden="true"
            onPointerDown={onWindowPointerDown}
            onPointerMove={onWindowPointerMove}
            onPointerUp={onWindowPointerUp}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        <div className="timeline-handles" style={{ '--sel0': sel0, '--sel1': sel1 } as CSSProperties}>
          <input
            type="range"
            aria-label="Start year"
            aria-valuetext={formatYear(y0)}
            min={0}
            max={RES}
            step={1}
            value={Math.round(sel0 * RES)}
            onChange={(e) => setFilters({ yearRange: [Math.min(scale.toYear(Number(e.target.value) / RES), y1), y1] })}
          />
          <input
            type="range"
            aria-label="End year"
            aria-valuetext={formatYear(y1)}
            min={0}
            max={RES}
            step={1}
            value={Math.round(sel1 * RES)}
            onChange={(e) =>
              setFilters({ yearRange: [y0, Math.max(y0, Math.min(meta.max_year, scale.toYear(Number(e.target.value) / RES) - 1))] })
            }
          />
        </div>

        {hovered && (
          <div
            className="tnum pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-md border border-line bg-panel-solid px-2 py-1 text-[11px] whitespace-nowrap text-ink shadow-lg"
            style={{ left: `${Math.min(92, Math.max(8, ((hovered.p0 + hovered.p1) / 2) * 100))}%` }}
          >
            {formatPeriod(hovered.start, hovered.end)}: {formatCount(hovered.count)} events
            <span className="text-ink-3"> · click to show</span>
          </div>
        )}
      </div>
      <div className="tnum relative mt-1 h-3.5 text-[10px] text-ink-3" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t.year}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: `${t.pos * 100}%`,
              transform: t.align === 'center' ? 'translateX(-50%)' : t.align === 'end' ? 'translateX(-100%)' : undefined,
            }}
          >
            {formatYear(t.year)}
          </span>
        ))}
      </div>
    </div>
  );
}
