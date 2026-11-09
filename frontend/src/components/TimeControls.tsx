import type { CSSProperties } from 'react';
import { visibleWindow } from '../lib/filters';
import { formatCount } from '../lib/format';
import { SPEEDS, WINDOW_SIZES, windowStartBounds } from '../lib/playback';
import { formatMonthYear, formatPeriod, formatYear } from '../lib/time';
import { useQuakeStore } from '../store/useQuakeStore';
import { CompletenessNotice } from './CompletenessNotice';

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Play/pause, scrubber, window size, mode and speed, with the current period shown large.
 *
 * Layout: notice · [play, period, all/window toggle] · [scrubber, selects].
 */
export function TimeControls() {
  const filters = useQuakeStore((s) => s.filters);
  const playback = useQuakeStore((s) => s.playback);
  const visibleCount = useQuakeStore((s) => s.visibleCount);
  const setPlayback = useQuakeStore((s) => s.setPlayback);
  const togglePlay = useQuakeStore((s) => s.togglePlay);
  if (!filters) return null;

  const [y0, y1] = filters.yearRange;
  const [lo, hi] = windowStartBounds(filters, playback.windowSize);
  const [w0, w1] = visibleWindow(filters, playback);
  const progress = hi > lo ? ((playback.windowStart - lo) / (hi - lo)) * 100 : 100;
  const span = y1 - y0 + 1;

  let period: string;
  let caption: string;
  if (!playback.windowEnabled) {
    period = y0 === y1 ? formatYear(y0) : `${formatYear(y0)} – ${formatYear(y1)}`;
    caption = 'All years in range';
  } else if (playback.mode === 'cumulative') {
    period = `Up to ${Number.isInteger(w1) ? formatYear(w1 - 1) : formatMonthYear(w1)}`;
    caption = `Cumulative from ${formatYear(y0)}`;
  } else {
    period = formatPeriod(w0, w1);
    caption = `${playback.windowSize}-year window`;
  }

  return (
    <section className="panel px-3 pt-2 pb-3 sm:px-4" aria-label="Time controls">
      <div className="mb-2">
        <CompletenessNotice />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playback.playing ? 'Pause' : 'Play through time'}
          title="Play / pause (space)"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-lg hover:brightness-110"
        >
          <PlayIcon playing={playback.playing} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="tnum text-xl leading-tight font-semibold tracking-tight sm:truncate sm:text-3xl">{period}</div>
          <div className="tnum truncate text-xs text-ink-3">
            {caption}
            {visibleCount != null && <> · {formatCount(visibleCount)} on map</>}
          </div>
        </div>
        <div
          className="hidden shrink-0 rounded-lg border border-line p-0.5 text-xs sm:flex"
          role="group"
          aria-label="Time filter"
        >
          {(['all', 'window'] as const).map((key) => {
            const active = key === 'window' ? playback.windowEnabled : !playback.windowEnabled;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setPlayback({ windowEnabled: key === 'window', playing: false })}
                className={`rounded-md px-2.5 py-1 ${active ? 'bg-raised text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {key === 'all' ? 'All years' : 'Window'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[14rem] flex-1 items-center gap-2">
          <span className="tnum shrink-0 text-[11px] text-ink-3">{formatYear(y0)}</span>
          <input
            type="range"
            className="scrubber"
            aria-label="Time window position"
            aria-valuetext={period}
            min={lo}
            max={hi}
            step="any"
            value={playback.windowStart}
            disabled={hi <= lo}
            onChange={(e) => setPlayback({ windowStart: Number(e.target.value), windowEnabled: true })}
            style={{ '--progress': `${playback.windowEnabled ? progress : 100}%` } as CSSProperties}
          />
          <span className="tnum shrink-0 text-[11px] text-ink-3">{formatYear(y1)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* On phones the all/window toggle moves down here to free room for the period label. */}
          <label className="flex items-center gap-1.5 text-ink-2 sm:hidden">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)]"
              checked={playback.windowEnabled}
              onChange={(e) => setPlayback({ windowEnabled: e.target.checked, playing: false })}
            />
            Window
          </label>
          <select
            className="control"
            aria-label="Window size"
            value={playback.windowSize}
            onChange={(e) => setPlayback({ windowSize: Number(e.target.value), windowEnabled: true })}
          >
            {WINDOW_SIZES.filter((w) => w <= Math.max(1, span)).map((w) => (
              <option key={w} value={w}>
                {w}-yr window
              </option>
            ))}
          </select>
          <select
            className="control"
            aria-label="Window mode"
            value={playback.mode}
            onChange={(e) => setPlayback({ mode: e.target.value as 'rolling' | 'cumulative', windowEnabled: true })}
          >
            <option value="rolling">Rolling</option>
            <option value="cumulative">Cumulative</option>
          </select>
          <select
            className="control"
            aria-label="Playback speed"
            value={playback.speed}
            onChange={(e) => setPlayback({ speed: Number(e.target.value) })}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} yr/s
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
