/**
 * Catalog completeness by era. Approximate thresholds, compiled from the
 * USGS ComCat documentation, the ISC-GEM catalogue papers and NOAA NCEI notes.
 * Sparse older data reflects how quakes were recorded, not how often they happened.
 */
export interface Era {
  id: string;
  label: string;
  /** First year (inclusive). */
  start: number;
  /** End year (exclusive). */
  end: number;
  summary: string;
}

export const ERAS: readonly Era[] = [
  {
    id: 'historical',
    label: 'Historical',
    start: Number.NEGATIVE_INFINITY,
    end: 1900,
    summary:
      'Only significant events that caused damage or deaths and were written down (NOAA). Coverage is concentrated where written records survive, such as the Mediterranean, the Middle East, China and Japan.',
  },
  {
    id: 'early',
    label: 'Early instrumental',
    start: 1900,
    end: 1964,
    summary: 'Few seismographs. The global catalog is roughly complete only above about M 6.5–7.',
  },
  {
    id: 'wwssn',
    label: 'WWSSN / ISC',
    start: 1964,
    end: 1973,
    summary: 'A standardized worldwide network. The catalog is roughly complete above about M 5.5.',
  },
  {
    id: 'modern',
    label: 'Modern',
    start: 1973,
    end: Number.POSITIVE_INFINITY,
    summary:
      'Global catalog roughly complete above about M 4.5–5. Dense regional networks (for example in the US and Japan) record far smaller events, so those regions look busier.',
  },
];

/** Eras that overlap `[startYear, endYear]` inclusive. */
export function erasInRange(startYear: number, endYear: number): Era[] {
  return ERAS.filter((e) => e.start <= endYear && e.end > startYear);
}
