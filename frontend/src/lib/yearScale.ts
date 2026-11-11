/**
 * Piecewise-linear mapping between slider position (0-1) and year.
 *
 * The catalog spans 2150 BCE to today, but nearly all events are after 1900. A
 * linear slider would squeeze the instrumental era into a few pixels, so the
 * track is split: ~10% for before 1000 CE, ~15% for 1000-1900, ~75% for 1900+.
 */
export interface YearScale {
  toPos(year: number): number;
  /** Whole year at a position. */
  toYear(pos: number): number;
  /** Fractional year at a position (for dragging a playback window). */
  toDecimalYear(pos: number): number;
}

const ANCHORS: readonly [number, number][] = [
  [1000, 0.1],
  [1900, 0.15],
];
const MODERN_WEIGHT = 0.75;

export function makeYearScale(minYear: number, maxYear: number): YearScale {
  const years = [minYear];
  const weights: number[] = [];
  for (const [anchor, weight] of ANCHORS) {
    if (anchor > minYear && anchor < maxYear) {
      years.push(anchor);
      weights.push(weight);
    }
  }
  years.push(maxYear);
  weights.push(MODERN_WEIGHT);
  const total = weights.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (const w of weights) cum.push(cum.at(-1)! + w / total);

  const toDecimalYear = (pos: number): number => {
    const p = Math.min(1, Math.max(0, pos));
    for (let i = 1; i < cum.length; i++) {
      if (p <= cum[i]) {
        const t = cum[i] === cum[i - 1] ? 0 : (p - cum[i - 1]) / (cum[i] - cum[i - 1]);
        return years[i - 1] + t * (years[i] - years[i - 1]);
      }
    }
    return maxYear;
  };

  return {
    toPos(year) {
      if (maxYear === minYear) return 0;
      const y = Math.min(maxYear, Math.max(minYear, year));
      for (let i = 1; i < years.length; i++) {
        if (y <= years[i]) {
          const t = (y - years[i - 1]) / (years[i] - years[i - 1]);
          return cum[i - 1] + t * (cum[i] - cum[i - 1]);
        }
      }
      return 1;
    },
    toYear: (pos) => Math.round(toDecimalYear(pos)),
    toDecimalYear,
  };
}
