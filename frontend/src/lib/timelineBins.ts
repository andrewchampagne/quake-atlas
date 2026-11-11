/**
 * Histogram buckets for the timeline track.
 *
 * Buckets are evenly spaced in *track position*, not in years: the track uses
 * the non-linear year scale, so a bucket before 1000 CE spans centuries while a
 * modern one spans about a year. Heights therefore use the event *rate* (events
 * per year), which keeps eras comparable.
 */
import type { YearCount } from '../api/types';
import { formatYear } from './time';
import type { YearScale } from './yearScale';

export interface TimelineBin {
  /** First year (inclusive). */
  start: number;
  /** Year after the last (exclusive). */
  end: number;
  /** Track positions in [0, 1]. */
  p0: number;
  p1: number;
  count: number;
  /** Events per year. */
  rate: number;
}

/**
 * Bins covering `[minYear, endYear)` for a scale built over the same span.
 * Bucket edges are whole years, so very short buckets merge into their neighbours.
 */
export function timelineBins(
  perYear: readonly YearCount[],
  scale: YearScale,
  minYear: number,
  endYear: number,
  buckets = 160,
): TimelineBin[] {
  const edges = [minYear];
  for (let k = 1; k < buckets; k++) {
    const y = Math.round(scale.toDecimalYear(k / buckets));
    if (y > edges.at(-1)! && y < endYear) edges.push(y);
  }
  edges.push(endYear);
  const bins: TimelineBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    bins.push({
      start: edges[i],
      end: edges[i + 1],
      p0: scale.toPos(edges[i]),
      p1: scale.toPos(edges[i + 1]),
      count: 0,
      rate: 0,
    });
  }
  for (const { year, count } of perYear) {
    const i = upperBound(edges, year) - 1;
    if (i >= 0 && i < bins.length) bins[i].count += count;
  }
  for (const b of bins) b.rate = b.count / (b.end - b.start);
  return bins;
}

/** Index of the first edge greater than `value`. */
function upperBound(edges: readonly number[], value: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Rates at or below this (events per year) get the shortest visible bar. */
export const MIN_RATE = 0.01;

/**
 * Bar height in [0, 1] on a log axis of the rate from {@link MIN_RATE} to
 * `maxRate`, so sparse historical eras stay readable next to the modern record.
 */
export function binHeight(bin: TimelineBin, maxRate: number): number {
  if (bin.count === 0 || maxRate <= 0) return 0;
  const lo = Math.log10(MIN_RATE);
  const hi = Math.log10(Math.max(maxRate, MIN_RATE * 10));
  return Math.min(1, Math.max(0.06, (Math.log10(Math.max(bin.rate, MIN_RATE)) - lo) / (hi - lo)));
}

export interface Tick {
  year: number;
  pos: number;
  align: 'start' | 'center' | 'end';
}

/** Ticks that fit without overlapping at this width (first and last always kept). */
export function layoutTicks(candidates: Tick[], width: number, charPx = 6, gap = 10): Tick[] {
  const span = (t: Tick): [number, number] => {
    const x = t.pos * width;
    const w = formatYear(t.year).length * charPx;
    return t.align === 'start' ? [x, x + w] : t.align === 'end' ? [x - w, x] : [x - w / 2, x + w / 2];
  };
  const ordered = [candidates[0], candidates.at(-1)!, ...candidates.slice(1, -1)];
  const kept: Tick[] = [];
  for (const t of ordered) {
    const [a, b] = span(t);
    if (kept.every((k) => {
      const [c, d] = span(k);
      return b + gap <= c || d + gap <= a;
    })) kept.push(t);
  }
  return kept.sort((x, y) => x.pos - y.pos);
}
