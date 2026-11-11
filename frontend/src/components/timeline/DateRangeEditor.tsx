import { useState } from 'react';
import type { Meta } from '../../api/types';
import { formatYear } from '../../lib/time';
import { useQuakeStore } from '../../store/useQuakeStore';

/** Conventional signed year for inputs (464 BCE → -464) ↔ astronomical year (-463). */
const toSigned = (astro: number) => (astro <= 0 ? astro - 1 : astro);
const fromSigned = (signed: number) => (signed < 0 ? signed + 1 : Math.max(1, signed));

function YearInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (year: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, fromSigned(n))));
    setDraft(null);
  };
  return (
    <label className="flex flex-1 flex-col gap-1 text-[11px] text-ink-3">
      {label}
      <input
        type="number"
        inputMode="numeric"
        className="field tnum"
        value={draft ?? String(toSigned(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="text-ink-2">{formatYear(value)}</span>
    </label>
  );
}

function datePresets(meta: Meta): { label: string; range: [number, number] }[] {
  const max = meta.max_year;
  const candidates: { label: string; range: [number, number] }[] = [
    { label: 'All', range: [meta.min_year, max] },
    { label: '1900+', range: [1900, max] },
    { label: '1973+', range: [1973, max] },
    { label: '2000+', range: [2000, max] },
    { label: 'Last 10 yrs', range: [max - 9, max] },
  ];
  const seen = new Set<number>();
  return candidates.filter(({ range: [a] }) => {
    const ok = a >= meta.min_year && a <= max && !seen.has(a);
    seen.add(a);
    return ok;
  });
}

/** Presets and typed years: the only place to type a date range. */
export function DateRangeEditor() {
  const meta = useQuakeStore((s) => s.meta);
  const filters = useQuakeStore((s) => s.filters);
  const setFilters = useQuakeStore((s) => s.setFilters);
  if (!meta || !filters) return null;
  const [y0, y1] = filters.yearRange;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="eyebrow mb-1.5">Date range</h3>
        <div className="flex flex-wrap gap-1.5">
          {datePresets(meta).map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              aria-pressed={p.range[0] === y0 && p.range[1] === y1}
              onClick={() => setFilters({ yearRange: p.range })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <YearInput label="From" value={y0} min={meta.min_year} max={y1} onCommit={(y) => setFilters({ yearRange: [y, y1] })} />
        <YearInput label="To" value={y1} min={y0} max={meta.max_year} onCommit={(y) => setFilters({ yearRange: [y0, y] })} />
      </div>
      <p className="text-[11px] text-ink-3">Negative years are BCE (−464 = 464 BCE). You can also drag the handles on the timeline.</p>
    </div>
  );
}
