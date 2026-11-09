import { describe, expect, it } from 'vitest';
import { FILTERS, META, PLAYBACK } from '../test/fixtures';
import {
  covers,
  defaultFilters,
  gpuFilterRange,
  needsRefetch,
  toSearchParams,
  toServerQuery,
  UNKNOWN_DEPTH_FILTER,
  visibleWindow,
} from './filters';
import { yearStartMs } from './time';

describe('defaultFilters / toServerQuery', () => {
  it('defaults to the full dataset and an empty query', () => {
    const f = defaultFilters(META);
    expect(f).toEqual(FILTERS);
    expect(toServerQuery(f, META)).toEqual({});
  });

  it('includes only bounds narrower than the dataset', () => {
    const q = toServerQuery(
      { ...FILTERS, yearRange: [2000, 2024], magRange: [6, 9.1], sources: ['usgs'] },
      META,
    );
    expect(q).toEqual({ start: yearStartMs(2000), minMag: 6, sources: ['usgs'] });
  });

  it('makes the end year inclusive via an exclusive next-year bound', () => {
    const q = toServerQuery({ ...FILTERS, yearRange: [1900, 1999] }, META);
    expect(q.start).toBe(yearStartMs(1900));
    expect(q.end).toBe(yearStartMs(2000));
  });

  it('sends both depth bounds once depth is filtered', () => {
    const q = toServerQuery({ ...FILTERS, depthRange: [0, 70] }, META);
    expect(q).toEqual({ minDepth: 0, maxDepth: 70 });
  });
});

describe('covers / needsRefetch', () => {
  const loaded = { start: yearStartMs(1900), minMag: 5 };

  it('narrowing needs no refetch', () => {
    expect(covers(loaded, { start: yearStartMs(2000), minMag: 6 })).toBe(true);
    expect(covers({}, { minDepth: 0, maxDepth: 70, sources: ['noaa'] })).toBe(true);
  });

  it('widening needs a refetch', () => {
    expect(covers(loaded, { start: yearStartMs(1800), minMag: 5 })).toBe(false);
    expect(covers(loaded, {})).toBe(false);
    expect(covers({ sources: ['usgs'] }, {})).toBe(false);
    expect(covers({ minDepth: 0, maxDepth: 70 }, {})).toBe(false);
  });

  it('refetches downsampled data on any change, even narrowing', () => {
    expect(needsRefetch({ query: {}, downsampled: true }, {})).toBe(false);
    expect(needsRefetch({ query: {}, downsampled: true }, { minMag: 6 })).toBe(true);
    expect(needsRefetch({ query: {}, downsampled: false }, { minMag: 6 })).toBe(false);
    expect(needsRefetch(null, {})).toBe(true);
  });
});

describe('toSearchParams', () => {
  it('uses the API parameter names and repeats sources', () => {
    const p = toSearchParams({ start: 1, maxMag: 7.5, sources: ['usgs', 'noaa'] });
    expect(p.toString()).toBe('start=1&max_mag=7.5&sources=usgs&sources=noaa');
  });
});

describe('GPU filter ranges', () => {
  it('covers the whole date range when the window is off', () => {
    const [time, mag, depth, source] = gpuFilterRange(FILTERS, META, PLAYBACK)!;
    expect(time[0]).toBe(-2149);
    expect(time[1]).toBeCloseTo(2025, 3);
    expect(time[1]).toBeLessThan(2025);
    expect(mag).toEqual([3, 9.1]);
    expect(depth[0]).toBeLessThan(UNKNOWN_DEPTH_FILTER); // unknown depths pass
    expect(source).toEqual([0, 1]);
  });

  it('uses the playback window and excludes unknown depth when depth is filtered', () => {
    const filters = { ...FILTERS, depthRange: [0, 70] as [number, number], sources: ['noaa'] };
    const playback = { ...PLAYBACK, windowEnabled: true };
    const [time, , depth, source] = gpuFilterRange(filters, META, playback)!;
    expect(time[0]).toBe(2000);
    expect(time[1]).toBeCloseTo(2005, 3);
    expect(depth).toEqual([0, 70]);
    expect(UNKNOWN_DEPTH_FILTER < depth[0]).toBe(true);
    expect(source).toEqual([1, 1]);
  });

  it('returns null when every source is off', () => {
    expect(gpuFilterRange({ ...FILTERS, sources: [] }, META, PLAYBACK)).toBeNull();
  });

  it('cumulative windows start at the beginning of the range', () => {
    const pb = { ...PLAYBACK, windowEnabled: true, mode: 'cumulative' as const };
    expect(visibleWindow({ ...FILTERS, yearRange: [1990, 2024] }, pb)).toEqual([1990, 2005]);
  });
});
