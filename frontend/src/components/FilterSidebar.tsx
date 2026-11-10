import { useMemo, useState, type ReactNode } from 'react';
import type { Meta } from '../api/types';
import { depthBounds, isDepthActive, magBounds, type Filters } from '../lib/filters';
import { formatCount } from '../lib/format';
import { formatYear } from '../lib/time';
import { makeYearScale } from '../lib/yearScale';
import { useQuakeStore } from '../store/useQuakeStore';
import { RangeSlider } from './RangeSlider';

/** Conventional signed year for inputs (464 BCE → -464) ↔ astronomical year (-463). */
const toSigned = (astro: number) => (astro <= 0 ? astro - 1 : astro);
const fromSigned = (signed: number) => (signed < 0 ? signed + 1 : Math.max(1, signed));

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside && <span className="tnum text-xs text-ink-2">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

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

function presetsFor(meta: Meta): { label: string; range: [number, number] }[] {
  const max = meta.max_year;
  const candidates: { label: string; range: [number, number] }[] = [
    { label: 'All', range: [meta.min_year, max] },
    { label: '1900+', range: [1900, max] },
    { label: '1973+', range: [1973, max] },
    { label: '2000+', range: [2000, max] },
    { label: 'Last 10 yrs', range: [max - 9, max] },
  ];
  const seen = new Set<string>();
  return candidates.filter(({ range: [a] }) => {
    const ok = a >= meta.min_year && a <= max && !seen.has(String(a));
    seen.add(String(a));
    return ok;
  });
}

function FilterContent({ meta, filters }: { meta: Meta; filters: Filters }) {
  const setFilters = useQuakeStore((s) => s.setFilters);
  const resetFilters = useQuakeStore((s) => s.resetFilters);
  const yearScale = useMemo(() => makeYearScale(meta.min_year, meta.max_year), [meta]);
  const presets = useMemo(() => presetsFor(meta), [meta]);
  const [magMin, magMax] = magBounds(meta);
  const [depthMin, depthMax] = depthBounds(meta);
  const [y0, y1] = filters.yearRange;
  const depthActive = isDepthActive(filters, meta);

  const toggleSource = (id: string) => {
    const on = filters.sources.includes(id);
    setFilters({ sources: on ? filters.sources.filter((s) => s !== id) : [...filters.sources, id] });
  };

  return (
    <>
      <Section title="Date range" aside={`${formatYear(y0)} – ${formatYear(y1)}`}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {presets.map((p) => {
            const active = p.range[0] === y0 && p.range[1] === y1;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setFilters({ yearRange: p.range })}
                aria-pressed={active}
                className="chip"
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <RangeSlider
          label="Years"
          value={filters.yearRange}
          min={meta.min_year}
          max={meta.max_year}
          step={1}
          toPos={yearScale.toPos}
          toValue={yearScale.toYear}
          format={formatYear}
          onChange={(yearRange) => setFilters({ yearRange })}
        />
        <div className="mt-1 flex gap-2">
          <YearInput
            label="From"
            value={y0}
            min={meta.min_year}
            max={y1}
            onCommit={(y) => setFilters({ yearRange: [y, y1] })}
          />
          <YearInput
            label="To"
            value={y1}
            min={y0}
            max={meta.max_year}
            onCommit={(y) => setFilters({ yearRange: [y0, y] })}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
          Type negative years for BCE (−464 = 464 BCE). The slider gives more room to recent years,
          where most records are.
        </p>
      </Section>

      <Section title="Magnitude" aside={`M ${filters.magRange[0].toFixed(1)} – ${filters.magRange[1].toFixed(1)}`}>
        <RangeSlider
          label="Magnitude"
          value={filters.magRange}
          min={magMin}
          max={magMax}
          step={0.1}
          format={(v) => `M ${v.toFixed(1)}`}
          onChange={(magRange) => setFilters({ magRange })}
        />
      </Section>

      <Section title="Depth" aside={`${filters.depthRange[0]} – ${filters.depthRange[1]} km`}>
        <RangeSlider
          label="Depth"
          value={filters.depthRange}
          min={depthMin}
          max={depthMax}
          step={5}
          format={(v) => `${v} km`}
          onChange={(depthRange) => setFilters({ depthRange })}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
          {depthActive
            ? 'Events with unknown depth (most pre-1900 records) are hidden while depth is filtered.'
            : 'Includes events with unknown depth (shown in grey).'}
        </p>
      </Section>

      <Section title="Sources">
        <ul className="space-y-1.5">
          {meta.sources.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={filters.sources.includes(s.id)}
                  onChange={() => toggleSource(s.id)}
                />
                <span className="flex-1">
                  <span className="text-ink">{s.label}</span>
                  <span className="tnum block text-xs text-ink-3">
                    {formatCount(s.count)} events · {s.id === 'noaa' ? 'before 1900' : '1900 onward'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {filters.sources.length === 0 && (
          <p className="mt-2 text-xs text-warn">All sources are off, so the map is empty.</p>
        )}
      </Section>

      <div className="border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={resetFilters}
          className="btn w-full"
        >
          Reset filters
        </button>
      </div>

      <footer className="px-4 pb-4 text-[11px] leading-relaxed text-ink-3">
        Data:{' '}
        <a className="link" href="https://earthquake.usgs.gov/fdsnws/event/1/" target="_blank" rel="noreferrer">
          USGS ComCat
        </a>
        ,{' '}
        <a
          className="link"
          href="https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/search"
          target="_blank"
          rel="noreferrer"
        >
          NOAA NCEI
        </a>
        . Basemap © CARTO, © OpenStreetMap contributors.
      </footer>
    </>
  );
}

/** Left sidebar with all filters. A slide-over drawer on small screens. */
export function FilterSidebar() {
  const meta = useQuakeStore((s) => s.meta);
  const filters = useQuakeStore((s) => s.filters);
  const open = useQuakeStore((s) => s.sidebarOpen);
  const setOpen = useQuakeStore((s) => s.setSidebarOpen);
  if (!meta || !filters) return null;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        id="filter-sidebar"
        aria-label="Filters"
        className={`panel fixed top-[4.5rem] bottom-3 left-3 z-30 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-[110%]'
        }`}
      >
        <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Quake Atlas</h1>
            <p className="tnum text-xs text-ink-2">
              {formatCount(meta.total)} earthquakes, {formatYear(meta.min_year)} – {formatYear(meta.max_year)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn btn-ghost btn-icon"
            aria-label="Hide filters"
          >
            «
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <FilterContent meta={meta} filters={filters} />
        </div>
      </aside>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-controls="filter-sidebar"
          aria-expanded={open}
          className="panel fixed top-[4.5rem] left-3 z-30 px-3 py-2 text-sm text-ink hover:border-line-strong"
        >
          ☰ Filters
        </button>
      )}
    </>
  );
}
