import type { YearCount } from '../api/types';
import { formatYear } from './time';

export interface Bin {
  /** First year in the bin (inclusive). */
  start: number;
  /** Year after the last (exclusive). */
  end: number;
  count: number;
  label: string;
}

const BIN_SIZES = [1, 2, 5, 10, 25, 50, 100, 250, 500];

/** Smallest "nice" bin width that keeps the chart at or under `maxBins` bars. */
export function chooseBinSize(startYear: number, endYear: number, maxBins = 120): number {
  const span = endYear - startYear + 1;
  return BIN_SIZES.find((size) => Math.ceil(span / size) <= maxBins) ?? BIN_SIZES.at(-1)!;
}

/**
 * Dense bins covering `[startYear, endYear]` inclusive, including empty ones so
 * gaps in the record stay visible instead of being silently compressed.
 */
export function binCounts(
  perYear: readonly YearCount[],
  startYear: number,
  endYear: number,
  size: number,
): Bin[] {
  const first = Math.floor(startYear / size) * size;
  const n = Math.max(0, Math.floor((endYear - first) / size) + 1);
  const bins: Bin[] = Array.from({ length: n }, (_, i) => {
    const start = first + i * size;
    const end = start + size;
    const label = size === 1 ? formatYear(start) : `${formatYear(start)} – ${formatYear(end - 1)}`;
    return { start, end, count: 0, label };
  });
  for (const { year, count } of perYear) {
    const i = Math.floor((year - first) / size);
    if (i >= 0 && i < n) bins[i].count += count;
  }
  return bins;
}
