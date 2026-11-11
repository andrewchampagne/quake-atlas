import { SPEEDS, WINDOW_SIZES } from '../../lib/playback';
import { useQuakeStore } from '../../store/useQuakeStore';
import { GearIcon } from '../ui/icons';
import { Popover } from '../ui/Popover';

/** ⚙ popover: how playback moves through time. */
export function PlaybackSettings() {
  const filters = useQuakeStore((s) => s.filters);
  const playback = useQuakeStore((s) => s.playback);
  const setPlayback = useQuakeStore((s) => s.setPlayback);
  if (!filters) return null;
  const span = filters.yearRange[1] - filters.yearRange[0] + 1;

  return (
    <Popover
      label="Playback settings"
      side="top"
      align="end"
      className="w-64"
      trigger={
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Playback settings" title="Playback settings">
          <GearIcon />
        </button>
      }
    >
      <h3 className="eyebrow mb-2">Playback</h3>
      <div className="space-y-3 text-xs">
        <label className="flex items-center justify-between gap-3 text-ink-2">
          Window length
          <select
            className="field"
            value={playback.windowSize}
            onChange={(e) => setPlayback({ windowSize: Number(e.target.value) })}
          >
            {WINDOW_SIZES.filter((w) => w <= Math.max(1, span)).map((w) => (
              <option key={w} value={w}>
                {w} {w === 1 ? 'year' : 'years'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-ink-2">
          Speed
          <select className="field" value={playback.speed} onChange={(e) => setPlayback({ speed: Number(e.target.value) })}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} yr/s
              </option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={playback.mode === 'cumulative'}
            onChange={(e) => setPlayback({ mode: e.target.checked ? 'cumulative' : 'rolling' })}
          />
          <span>
            <span className="text-ink">Accumulate</span>
            <span className="block text-ink-3">Keep earlier years on the map as playback moves on.</span>
          </span>
        </label>
      </div>
    </Popover>
  );
}
