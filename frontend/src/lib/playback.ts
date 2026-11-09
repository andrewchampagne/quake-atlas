import type { Filters, Playback } from './filters';

export const WINDOW_SIZES = [1, 2, 5, 10, 25, 50, 100, 500] as const;
export const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250] as const;

/** Valid range for `windowStart` given the date range `[y0, y1]` (inclusive years). */
export function windowStartBounds(filters: Filters, windowSize: number): [number, number] {
  const lo = filters.yearRange[0];
  const hi = filters.yearRange[1] + 1;
  return [lo, Math.max(lo, hi - windowSize)];
}

/** Clamp a playback state so its window lies inside the date range. */
export function clampPlayback(pb: Playback, filters: Filters): Playback {
  const [lo, hi] = windowStartBounds(filters, pb.windowSize);
  const windowStart = Math.min(hi, Math.max(lo, pb.windowStart));
  return windowStart === pb.windowStart ? pb : { ...pb, windowStart };
}

/**
 * Advance playback by `dtSeconds`. Stops (and stays at the end) once the window
 * reaches the end of the date range.
 */
export function advance(pb: Playback, filters: Filters, dtSeconds: number): Playback {
  if (!pb.playing) return pb;
  const [, hi] = windowStartBounds(filters, pb.windowSize);
  const next = pb.windowStart + pb.speed * dtSeconds;
  if (next >= hi) return { ...pb, windowStart: hi, playing: false };
  return { ...pb, windowStart: next };
}

/** Start playing; rewinds to the beginning if the window is already at the end. */
export function play(pb: Playback, filters: Filters): Playback {
  const [lo, hi] = windowStartBounds(filters, pb.windowSize);
  const atEnd = pb.windowStart >= hi - 1e-9;
  return { ...pb, windowEnabled: true, playing: true, windowStart: atEnd ? lo : pb.windowStart };
}

/** A playback speed that plays the whole range in roughly `seconds`. */
export function defaultSpeed(filters: Filters, seconds = 30): number {
  const span = filters.yearRange[1] - filters.yearRange[0] + 1;
  const target = span / seconds;
  return SPEEDS.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best));
}

/** A window size that is about 1/25 of the range (at least one year). */
export function defaultWindowSize(filters: Filters): number {
  const span = filters.yearRange[1] - filters.yearRange[0] + 1;
  const sizes = WINDOW_SIZES.filter((s) => s <= Math.max(1, span / 20));
  return sizes.at(-1) ?? 1;
}
