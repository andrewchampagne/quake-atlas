import { useState } from 'react';
import { ERAS, erasInRange } from '../lib/eras';
import { formatYear } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';

function eraYears(start: number, end: number): string {
  if (!Number.isFinite(start)) return `before ${end}`;
  if (!Number.isFinite(end)) return `${start} onward`;
  return `${formatYear(start)}–${formatYear(end - 1)}`;
}

/** Always-visible reminder that catalog completeness varies by era. */
export function CompletenessNotice() {
  const filters = useQuakeStore((s) => s.filters);
  const [open, setOpen] = useState(false);
  const eras = filters ? erasInRange(filters.yearRange[0], filters.yearRange[1]) : ERAS;

  return (
    <div className="relative text-xs text-ink-2">
      <p className="flex items-start gap-1.5 leading-snug">
        <span aria-hidden="true" className="mt-px text-warn">
          ⓘ
        </span>
        <span>
          <span className="text-ink">Catalog completeness varies by era.</span> Older records hold only large or
          damaging quakes, so sparse early data does not mean fewer earthquakes.{' '}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="completeness-details"
            className="link"
          >
            {open ? 'Hide details' : 'Details'}
          </button>
        </span>
      </p>
      {open && (
        <div
          id="completeness-details"
          className="panel absolute bottom-full left-0 z-20 mb-2 w-[min(32rem,calc(100vw-2rem))] p-3"
        >
          <h4 className="mb-2 text-sm font-semibold text-ink">How complete is the record?</h4>
          <ul className="space-y-2">
            {eras.map((era) => (
              <li key={era.id}>
                <div className="text-ink">
                  {era.label} <span className="text-ink-3">({eraYears(era.start, era.end)})</span>
                </div>
                <div className="text-ink-2">{era.summary}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ink-3">
            The bands on the per-year chart mark these eras. Magnitudes before about 1900 are estimated from damage
            reports, so they are uncertain.
          </p>
        </div>
      )}
    </div>
  );
}
