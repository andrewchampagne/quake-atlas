import { decodeDeathToll, formatDeathToll } from '../api/deaths';
import { formatDepth, formatMagnitude } from '../lib/format';
import { depthToRgb } from '../lib/scales';
import { formatDate } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';
import { useEventDetail } from './useEventDetail';

const OFFSET = 14;
const WIDTH = 248;

/** Floating tooltip for the hovered point. Core fields come from the typed arrays; the place name is fetched. */
export function HoverTooltip() {
  const hover = useQuakeStore((s) => s.hover);
  const events = useQuakeStore((s) => s.events);
  const noaaCode = useQuakeStore((s) => s.meta?.sources.find((src) => src.id === 'noaa')?.code);
  const valid = hover && events && hover.index < events.length;
  const rid = valid ? events.rid[hover.index] : null;
  const detail = useEventDetail(rid, 80);
  if (!valid) return null;

  const i = hover.index;
  // NOAA times are often known only to the day (or year): show the date alone.
  const isNoaa = events.source[i] === noaaCode;
  const depth = events.depth[i];
  const [r, g, b] = depthToRgb(depth);
  const left = Math.min(hover.x + OFFSET, window.innerWidth - WIDTH - 8);
  const top = Math.min(hover.y + OFFSET, window.innerHeight - 164);

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-40 rounded-lg border border-line bg-panel-solid/95 px-3 py-2 text-xs shadow-xl"
      style={{ left, top, width: WIDTH }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold text-ink">{formatMagnitude(events.magnitude[i])}</span>
        <span className="text-ink-2">{formatDate(events.time[i], !isNoaa)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-ink-2">
        <span className="inline-block h-0.5 w-3 rounded" style={{ background: `rgb(${r},${g},${b})` }} />
        {formatDepth(depth)}
      </div>
      <div className="mt-1 text-ink-2">
        Recorded deaths: <span className="tnum text-ink">{formatDeathToll(detail ?? decodeDeathToll(events.deaths?.[i]))}</span>
      </div>
      <div className="mt-1 min-h-4 truncate text-ink">
        {detail ? (detail.place ?? 'Unnamed location') : <span className="text-ink-3">Loading place…</span>}
      </div>
      <div className="mt-1 text-[10px] text-ink-3">Click for details</div>
    </div>
  );
}
