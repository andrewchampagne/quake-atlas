import { useEffect, type ReactNode } from 'react';
import type { Meta } from '../../api/types';
import { activeFilterChips, depthBounds, magBounds, type Filters } from '../../lib/filters';
import { formatCount } from '../../lib/format';
import { useQuakeStore } from '../../store/useQuakeStore';
import { RangeSlider } from '../RangeSlider';
import { CloseIcon, FilterIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';

function Section({ title, value, children }: { title: string; value?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {value && <span className="tnum text-xs text-ink-2">{value}</span>}
      </div>
      {children}
    </section>
  );
}

function Presets<T>({ options, isActive, onPick }: { options: { label: string; value: T }[]; isActive: (v: T) => boolean; onPick: (v: T) => void }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.label} type="button" className="chip" aria-pressed={isActive(o.value)} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const same = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

function FiltersForm({ meta, filters }: { meta: Meta; filters: Filters }) {
  const setFilters = useQuakeStore((s) => s.setFilters);
  const resetFilters = useQuakeStore((s) => s.resetFilters);
  const stats = useQuakeStore((s) => s.familyStats);
  const loadFamilyStats = useQuakeStore((s) => s.loadFamilyStats);
  const [magMin, magMax] = magBounds(meta);
  const [depthMin, depthMax] = depthBounds(meta);
  useEffect(() => {
    if (meta.families_ready) void loadFamilyStats();
  }, [meta.families_ready, loadFamilyStats]);

  const magPresets = [
    { label: 'All', value: [magMin, magMax] as [number, number] },
    ...[5, 6, 7].filter((m) => m > magMin && m < magMax).map((m) => ({ label: `${m}+`, value: [m, magMax] as [number, number] })),
  ];
  const depthPresets = [
    { label: 'Any', value: [depthMin, depthMax] as [number, number] },
    { label: 'Shallow <70 km', value: [depthMin, 70] as [number, number] },
    { label: '70–300 km', value: [70, 300] as [number, number] },
    { label: 'Deep 300+ km', value: [300, depthMax] as [number, number] },
  ].filter((p) => p.value[0] < p.value[1]);
  const toggleSource = (id: string) => {
    const on = filters.sources.includes(id);
    setFilters({ sources: on ? filters.sources.filter((s) => s !== id) : [...filters.sources, id] });
  };

  return (
    <div className="text-sm">
      <Section title="Magnitude" value={`M ${filters.magRange[0].toFixed(1)} – ${filters.magRange[1].toFixed(1)}`}>
        <RangeSlider
          label="Magnitude"
          value={filters.magRange}
          min={magMin}
          max={magMax}
          step={0.1}
          format={(v) => `M ${v.toFixed(1)}`}
          onChange={(magRange) => setFilters({ magRange })}
        />
        <Presets options={magPresets} isActive={(v) => same(v, filters.magRange)} onPick={(magRange) => setFilters({ magRange })} />
      </Section>

      <Section title="Depth" value={`${filters.depthRange[0]} – ${filters.depthRange[1]} km`}>
        <RangeSlider
          label="Depth"
          value={filters.depthRange}
          min={depthMin}
          max={depthMax}
          step={5}
          format={(v) => `${v} km`}
          onChange={(depthRange) => setFilters({ depthRange })}
        />
        <Presets options={depthPresets} isActive={(v) => same(v, filters.depthRange)} onPick={(depthRange) => setFilters({ depthRange })} />
        <p className="mt-1.5 text-[11px] text-ink-3">Filtering by depth hides events of unknown depth (most before 1900).</p>
      </Section>

      <Section title="Sources">
        <ul className="space-y-1">
          {meta.sources.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-baseline gap-2">
                <input type="checkbox" checked={filters.sources.includes(s.id)} onChange={() => toggleSource(s.id)} />
                <span className="flex-1 text-ink">{s.label}</span>
                <span className="tnum text-[11px] text-ink-3">
                  {formatCount(s.count)} · {s.id === 'noaa' ? 'pre-1900' : '1900+'}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Section>

      {meta.families_ready && (
        <Section title="Aftershocks">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={filters.declustered}
              onChange={(e) => setFilters({ declustered: e.target.checked })}
            />
            <span>
              <span className="text-ink">Hide foreshocks and aftershocks</span>
              <span className="block text-[11px] text-ink-3">
                Keeps mainshocks and independent events
                {stats && <> (removes {(stats.clustered_fraction * 100).toFixed(0)}% of instrumental events)</>}.
              </span>
            </span>
          </label>
        </Section>
      )}

      <div className="flex justify-end border-t border-line pt-3">
        <button type="button" className="btn btn-sm" onClick={resetFilters}>
          Reset all filters
        </button>
      </div>
    </div>
  );
}

/** Top-left toolbar: the Filters popover plus a removable chip for each active filter. */
export function FilterBar() {
  const meta = useQuakeStore((s) => s.meta);
  const filters = useQuakeStore((s) => s.filters);
  const setFilters = useQuakeStore((s) => s.setFilters);
  const resetFilters = useQuakeStore((s) => s.resetFilters);
  if (!meta || !filters) return null;
  const chips = activeFilterChips(filters, meta);
  const narrowing = chips.filter((c) => c.key !== 'years').length;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Filters">
      <Popover
        label="Filters"
        className="w-[min(21rem,calc(100vw-1.5rem))]"
        trigger={
          <button type="button" className="btn toolbar-button" aria-label={`Filters${narrowing ? `, ${narrowing} active` : ''}`}>
            <FilterIcon />
            Filters
            {narrowing > 0 && <span className="badge">{narrowing}</span>}
          </button>
        }
      >
        <FiltersForm meta={meta} filters={filters} />
      </Popover>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="chip chip-remove toolbar-chip"
          onClick={() => setFilters(chip.clear)}
          aria-label={`Remove filter: ${chip.label}`}
        >
          {chip.label}
          <CloseIcon />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" className="btn btn-ghost btn-sm toolbar-chip" onClick={resetFilters}>
          Clear all
        </button>
      )}
    </div>
  );
}
