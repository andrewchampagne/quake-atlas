import { ERAS, erasInRange } from '../../lib/eras';
import { formatYear } from '../../lib/time';
import { useQuakeStore } from '../../store/useQuakeStore';
import { InfoIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';

function eraYears(start: number, end: number): string {
  if (!Number.isFinite(start)) return `before ${end}`;
  if (!Number.isFinite(end)) return `${start} onward`;
  return `${formatYear(start)}–${formatYear(end - 1)}`;
}

/** How complete the catalog is in each era (shared by the timeline and the help dialog). */
export function EraList({ startYear, endYear }: { startYear?: number; endYear?: number }) {
  const eras = startYear != null && endYear != null ? erasInRange(startYear, endYear) : ERAS;
  return (
    <div className="text-xs leading-snug text-ink-2">
      <p>
        Older records hold only large or damaging quakes, so sparse early data does not mean fewer earthquakes. The
        shaded bands on the timeline mark these eras.
      </p>
      <ul className="mt-2 space-y-2">
        {eras.map((era) => (
          <li key={era.id}>
            <div className="text-ink">
              {era.label} <span className="text-ink-3">({eraYears(era.start, era.end)})</span>
            </div>
            <div>{era.summary}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-ink-3">Magnitudes before about 1900 are estimated from damage reports.</p>
    </div>
  );
}

/** ⓘ button explaining why older eras look sparse. */
export function EraInfo() {
  const filters = useQuakeStore((s) => s.filters);
  return (
    <Popover
      label="Catalog completeness"
      side="top"
      align="end"
      className="w-[min(26rem,calc(100vw-1.5rem))]"
      trigger={
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Why older eras look sparse" title="Catalog completeness">
          <InfoIcon />
        </button>
      }
    >
      <h3 className="mb-1.5 text-sm font-semibold">Catalog completeness varies by era</h3>
      <EraList startYear={filters?.yearRange[0]} endYear={filters?.yearRange[1]} />
    </Popover>
  );
}
