import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { covers, needsRefetch, summarizeEvents, toSearchParams } from '../lib/filters';
import { yearStartMs } from '../lib/time';
import { FILTERS, META, PLAYBACK } from '../test/fixtures';
import { decodeDeathToll, formatDeathToll } from './deaths';
import { decodeEvents } from './decode';
import type { EventColumns } from './types';

function catalog(): EventColumns {
  return {
    length: 7,
    rid: new Uint32Array([10, 11, 12, 13, 14, 15, 16]),
    time: new Float64Array([2000, 2001, 2001, 2002, 2003, 2004, 2005].map(yearStartMs)),
    lon: new Float32Array(7),
    lat: new Float32Array(7),
    depth: new Float32Array([10, 20, Number.NaN, 10, 10, 10, 10]),
    magnitude: new Float32Array([9.1, 8, 9.1, 7, 7, 7, 7]),
    source: new Uint8Array([0, 1, 1, 1, 0, 1, 0]),
    deaths: new Float32Array([0, 12, -4, -2, Number.NaN, -1, 2000]),
    role: new Uint8Array(7),
  };
}

describe('death toll contract', () => {
  it.each([
    [0, '0 (none recorded)'],
    [18_428, '18,428'],
    [-1, 'About 1–50 (approximate)'],
    [-2, 'About 51–100 (approximate)'],
    [-3, 'About 101–1,000 (approximate)'],
    [-4, 'Over 1,000 (approximate)'],
    [Number.NaN, 'Unknown'],
    [undefined, 'Unknown'],
    [-9, 'Unknown'],
  ])('formats encoded %s as %s', (encoded, label) => {
    expect(formatDeathToll(decodeDeathToll(encoded))).toBe(label);
  });

  it('prefers exact zero to a conflicting ordinal, and distinguishes ordinal zero from missing data', () => {
    expect(formatDeathToll({ deaths: 0, deaths_order: 4 })).toBe('0 (none recorded)');
    expect(formatDeathToll({ deaths: null, deaths_order: 0 })).toBe('0 (none recorded)');
    expect(formatDeathToll({ deaths: null, deaths_order: null })).toBe('Unknown');
  });

  it('decodes all Arrow death representations and preserves them across the wire', () => {
    const c = catalog();
    const wire = {
      rid: c.rid, time: c.time, lon: c.lon, lat: c.lat, depth_km: c.depth,
      magnitude: c.magnitude, source: c.source,
    };
    const decoded = decodeEvents(tableToIPC(tableFromArrays({ ...wire, deaths: c.deaths! }), 'stream'));
    expect(decoded.deaths).toBeInstanceOf(Float32Array);
    expect(Array.from(decoded.deaths!)).toEqual([0, 12, -4, -2, Number.NaN, -1, 2000]);
    const legacy = decodeEvents(tableToIPC(tableFromArrays(wire), 'stream'));
    expect(Array.from(legacy.deaths!)).toEqual(Array(7).fill(Number.NaN));
    const wrong = tableToIPC(tableFromArrays({ ...wire, deaths: new Float64Array(7) }), 'stream');
    expect(() => decodeEvents(wrong)).toThrow(/Column "deaths".*expected Float32Array/);
  });
});

describe('local death summary', () => {
  it('sums exact counts only, counts approximate deadly events, and matches server event ranking', () => {
    const summary = summarizeEvents(catalog(), FILTERS, META, PLAYBACK);
    expect(summary).toMatchObject({
      total: 7, total_deaths: 2012, deadly_events: 5, approx_deadly_events: 3,
      strongest: { rid: 10, deaths: 0, source: 'usgs' },
      deadliest: { rid: 16, deaths: 2000 },
      per_year: [
        { year: 2000, count: 1, deaths: 0 },
        { year: 2001, count: 2, deaths: 12 },
        { year: 2002, count: 1, deaths: 0 },
        { year: 2003, count: 1, deaths: 0 },
        { year: 2004, count: 1, deaths: 0 },
        { year: 2005, count: 1, deaths: 2000 },
      ],
    });
  });

  it('applies a half-open playback window and ranks ranges by their lower bounds', () => {
    const summary = summarizeEvents(catalog(), FILTERS, META, { ...PLAYBACK, windowEnabled: true });
    expect(summary).toMatchObject({
      total: 6, total_deaths: 12, deadly_events: 4, approx_deadly_events: 3,
      deadliest: { rid: 12, deaths: null, deaths_order: 4 },
    });
    const cumulative = summarizeEvents(catalog(), FILTERS, META, {
      ...PLAYBACK, windowEnabled: true, mode: 'cumulative', windowStart: 2002, windowSize: 1,
    });
    expect(cumulative.total).toBe(4);
    expect(cumulative.total_deaths).toBe(12);
  });

  it('recomputes death totals for source, magnitude, depth and date filters, excluding unknown depth only when filtered', () => {
    const filters = {
      ...FILTERS, sources: ['noaa'], yearRange: [2001, 2002] as [number, number],
      depthRange: [0, 20] as [number, number], magRange: [7.5, 9.1] as [number, number],
    };
    expect(summarizeEvents(catalog(), filters, META, PLAYBACK)).toMatchObject({
      total: 1, total_deaths: 12, deadly_events: 1, approx_deadly_events: 0,
      strongest: { rid: 11 }, deadliest: { rid: 11 },
    });
  });

  it('does not turn unknown tolls into deadly events or confuse recorded zero with unknown', () => {
    const c = catalog();
    const onlyZero = summarizeEvents(c, { ...FILTERS, yearRange: [2000, 2000] }, META, PLAYBACK);
    expect(onlyZero).toMatchObject({ total_deaths: 0, deadly_events: 0, deadliest: null, strongest: { deaths: 0 } });
    const onlyUnknown = summarizeEvents(c, { ...FILTERS, yearRange: [2003, 2003] }, META, PLAYBACK);
    expect(onlyUnknown).toMatchObject({ total_deaths: 0, deadly_events: 0, deadliest: null, strongest: { deaths: null } });
    const empty = summarizeEvents(c, { ...FILTERS, sources: [] }, META, PLAYBACK);
    expect(empty).toMatchObject({ total: 0, total_deaths: 0, deadly_events: 0, strongest: null, deadliest: null, per_year: [] });
    expect(summarizeEvents({ ...c, deaths: undefined }, FILTERS, META, PLAYBACK).total_deaths).toBeUndefined();
  });
});

describe('deadly query coverage', () => {
  it('serializes the flag and does not mistake a deadly-only subset for the full catalog', () => {
    expect(toSearchParams({ deadlyOnly: true }).toString()).toBe('deadly_only=true');
    expect(toSearchParams({ deadlyOnly: false }).toString()).toBe('');
    expect(covers({}, { deadlyOnly: true })).toBe(true);
    expect(covers({ deadlyOnly: true }, {})).toBe(false);
    expect(needsRefetch({ query: {}, downsampled: true }, { deadlyOnly: true })).toBe(true);
    expect(needsRefetch({ query: {}, downsampled: true }, { deadlyOnly: false })).toBe(false);
  });
});
