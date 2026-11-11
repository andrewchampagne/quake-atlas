import { useState } from 'react';
import { DEPTH_STOPS, UNKNOWN_DEPTH_COLOR, depthGradientCss, magnitudeToRadius } from '../lib/scales';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useQuakeStore } from '../store/useQuakeStore';
import { CloseIcon } from './ui/icons';

const MAGNITUDES = [4, 5, 6, 7, 8];
const COMPACT_QUERY = '(max-width: 1023px)';

/** Compact depth ramp and magnitude key; collapses to a chip (collapsed by default on smaller screens). */
export function Legend() {
  const compact = useMediaQuery(COMPACT_QUERY);
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !compact;
  const familyShown = useQuakeStore((s) => Boolean(s.family && s.family.size > 1 && s.pinned && s.family.members.rid.includes(s.pinned.rid)));
  const maxR = magnitudeToRadius(MAGNITUDES.at(-1)!) * 0.6;

  if (!open) {
    return (
      <button type="button" onClick={() => setChoice(true)} className="panel pointer-events-auto px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
        Legend
      </button>
    );
  }

  return (
    <section className="panel pointer-events-auto w-60 p-2.5 text-xs" aria-label="Map legend">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="eyebrow">Depth (km)</h3>
        <button type="button" onClick={() => setChoice(false)} className="btn btn-ghost btn-icon -mt-1 -mr-1 !min-h-6 !p-1" aria-label="Hide legend">
          <CloseIcon />
        </button>
      </div>
      <div className="h-2 rounded-full" style={{ background: depthGradientCss() }} role="img" aria-label="Shallow (yellow) to deep (blue)" />
      <div className="tnum relative mt-0.5 h-3.5 text-[10px] text-ink-3">
        {DEPTH_STOPS.map((s, i) => (
          <span
            key={s.depth}
            className="absolute"
            style={{
              left: `${(i / (DEPTH_STOPS.length - 1)) * 100}%`,
              transform: i === 0 ? undefined : i === DEPTH_STOPS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {i === DEPTH_STOPS.length - 1 ? `${s.depth}+` : s.depth}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-end justify-between" style={{ height: maxR * 2 + 12 }}>
        {MAGNITUDES.map((m) => {
          const r = magnitudeToRadius(m) * 0.6;
          return (
            <div key={m} className="flex flex-col items-center gap-0.5">
              <span className="rounded-full border border-ink-2/70 bg-ink/15" style={{ width: r * 2, height: r * 2 }} aria-hidden="true" />
              <span className="tnum text-[10px] text-ink-3">M{m}</span>
            </div>
          );
        })}
        <span className="flex flex-col items-center gap-0.5" title="Unknown depth">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: UNKNOWN_DEPTH_COLOR }} />
          <span className="text-[10px] text-ink-3">n/a</span>
        </span>
      </div>
      {familyShown && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-line pt-1.5 text-[10px] text-ink-3">
          <span className="inline-block h-px w-5 bg-ink" aria-hidden="true" />
          Family links to parents
        </div>
      )}
    </section>
  );
}
