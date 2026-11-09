import { useState } from 'react';
import { DEPTH_STOPS, UNKNOWN_DEPTH_COLOR, depthGradientCss, magnitudeToRadius } from '../lib/scales';

const MAGNITUDES = [4, 5, 6, 7, 8];

/** Depth colour ramp and magnitude size key. Collapsible on small screens. */
export function Legend() {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  const maxR = magnitudeToRadius(MAGNITUDES.at(-1)!);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="panel px-3 py-2 text-xs text-ink-2 hover:text-ink">
        Legend
      </button>
    );
  }

  return (
    <section className="panel w-64 p-3 text-xs" aria-label="Map legend">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Depth</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-1 text-ink-3 hover:text-ink sm:hidden"
          aria-label="Hide legend"
        >
          ✕
        </button>
      </div>
      <div className="h-2.5 rounded-full" style={{ background: depthGradientCss() }} role="img" aria-label="Shallow (yellow) to deep (blue)" />
      <div className="tnum relative mt-1 h-4 text-[10px] text-ink-2">
        {DEPTH_STOPS.map((s, i) => (
          <span
            key={s.depth}
            className="absolute -translate-x-1/2"
            style={{ left: `${(i / (DEPTH_STOPS.length - 1)) * 100}%` }}
          >
            {i === DEPTH_STOPS.length - 1 ? `${s.depth}+` : s.depth}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-3">
        <span>shallow · km · deep</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: UNKNOWN_DEPTH_COLOR }} />
          unknown
        </span>
      </div>

      <h3 className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Magnitude</h3>
      <div className="flex items-end justify-between" style={{ height: maxR * 2 + 14 }}>
        {MAGNITUDES.map((m) => {
          const r = magnitudeToRadius(m);
          return (
            <div key={m} className="flex flex-col items-center gap-1">
              <span
                className="rounded-full border border-ink-2/70 bg-ink/15"
                style={{ width: r * 2, height: r * 2 }}
                aria-hidden="true"
              />
              <span className="tnum text-[10px] text-ink-2">M{m}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-ink-3" title="Sizes also grow as you zoom in.">
        Radius ×1.8 per magnitude step
      </p>
    </section>
  );
}
