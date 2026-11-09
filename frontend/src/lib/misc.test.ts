import { describe, expect, it } from 'vitest';
import { FILTERS, PLAYBACK } from '../test/fixtures';
import { buildAttributes, FILTER_SIZE } from './attributes';
import { binCounts, chooseBinSize } from './bins';
import { erasInRange } from './eras';
import { UNKNOWN_DEPTH_FILTER } from './filters';
import { formatCount, formatDepth, formatLatLon, formatMagnitude } from './format';
import { advance, clampPlayback, defaultSpeed, play } from './playback';
import { magnitudeToRadius } from './scales';
import { makeYearScale } from './yearScale';

describe('bins', () => {
  it('picks a bin size that keeps the chart readable', () => {
    expect(chooseBinSize(2000, 2024)).toBe(1);
    expect(chooseBinSize(1900, 2024)).toBe(2);
    expect(chooseBinSize(-2149, 2024)).toBe(50);
  });

  it('builds dense bins including empty ones', () => {
    const bins = binCounts(
      [
        { year: 2001, count: 3 },
        { year: 2004, count: 2 },
        { year: 2005, count: 1 },
      ],
      2000,
      2009,
      5,
    );
    expect(bins.map((b) => [b.start, b.end, b.count])).toEqual([
      [2000, 2005, 5],
      [2005, 2010, 1],
    ]);
    expect(bins[0].label).toBe('2000 – 2004');
    const gaps = binCounts([{ year: 2003, count: 1 }], 2000, 2004, 1);
    expect(gaps.map((b) => b.count)).toEqual([0, 0, 0, 1, 0]);
  });

  it('aligns BCE bins to the bin size', () => {
    const bins = binCounts([{ year: -463, count: 1 }], -2149, -2000, 50);
    expect(bins[0].start).toBe(-2150);
  });
});

describe('eras', () => {
  it('selects eras overlapping a range', () => {
    expect(erasInRange(2000, 2024).map((e) => e.id)).toEqual(['modern']);
    expect(erasInRange(1950, 1980).map((e) => e.id)).toEqual(['early', 'wwssn', 'modern']);
    expect(erasInRange(-2000, 1899).map((e) => e.id)).toEqual(['historical']);
  });
});

describe('playback', () => {
  const filters = { ...FILTERS, yearRange: [2000, 2024] as [number, number] };

  it('advances by speed × dt and stops at the end', () => {
    const pb = { ...PLAYBACK, playing: true, windowStart: 2000, windowSize: 5, speed: 2 };
    expect(advance(pb, filters, 0.5).windowStart).toBe(2001);
    const end = advance({ ...pb, windowStart: 2019.9 }, filters, 1);
    expect(end.windowStart).toBe(2020);
    expect(end.playing).toBe(false);
  });

  it('rewinds when play is pressed at the end', () => {
    const pb = { ...PLAYBACK, windowStart: 2020, windowSize: 5 };
    const started = play(pb, filters);
    expect(started.windowStart).toBe(2000);
    expect(started.playing && started.windowEnabled).toBe(true);
  });

  it('clamps the window into the date range', () => {
    expect(clampPlayback({ ...PLAYBACK, windowStart: 1990 }, filters).windowStart).toBe(2000);
    expect(clampPlayback({ ...PLAYBACK, windowStart: 2030 }, filters).windowStart).toBe(2020);
  });

  it('chooses a speed that plays the range in about 30 s', () => {
    expect(defaultSpeed(filters)).toBe(1);
    expect(defaultSpeed({ ...FILTERS })).toBe(100);
  });
});

describe('year slider scale', () => {
  const scale = makeYearScale(-2149, 2024);

  it('maps the ends and anchors', () => {
    expect(scale.toPos(-2149)).toBe(0);
    expect(scale.toPos(2024)).toBe(1);
    expect(scale.toPos(1000)).toBeCloseTo(0.1);
    expect(scale.toPos(1900)).toBeCloseTo(0.25);
  });

  it('round-trips years', () => {
    for (const y of [-2149, -500, 1000, 1755, 1900, 1964, 2011, 2024]) {
      expect(Math.abs(scale.toYear(scale.toPos(y)) - y)).toBeLessThanOrEqual(1);
    }
  });

  it('is linear when the range has no anchors inside', () => {
    const modern = makeYearScale(2000, 2024);
    expect(modern.toPos(2012)).toBeCloseTo(0.5);
  });
});

describe('format', () => {
  it('formats values', () => {
    expect(formatCount(45443)).toBe('45,443');
    expect(formatMagnitude(7.25, 'mww')).toBe('M 7.3 (mww)');
    expect(formatDepth(null)).toBe('unknown depth');
    expect(formatDepth(Number.NaN)).toBe('unknown depth');
    expect(formatDepth(4.25)).toBe('4.3 km');
    expect(formatDepth(29.4)).toBe('29 km');
    expect(formatLatLon(-33.5, -70.25)).toBe('33.50°S, 70.25°W');
  });
});

describe('buildAttributes', () => {
  it('interleaves positions and filter values', () => {
    const attrs = buildAttributes({
      length: 2,
      rid: new Uint32Array([0, 1]),
      time: new Float64Array([Date.UTC(2011, 0, 1), Date.UTC(1755, 0, 1)]),
      lon: new Float32Array([142.4, -10]),
      lat: new Float32Array([38.3, 36.5]),
      depth: new Float32Array([29, Number.NaN]),
      magnitude: new Float32Array([9.1, 8.5]),
      source: new Uint8Array([0, 1]),
    });
    expect(Array.from(attrs.positions)).toEqual([
      Math.fround(142.4),
      Math.fround(38.3),
      -10,
      Math.fround(36.5),
    ]);
    expect(attrs.radii[0]).toBeCloseTo(magnitudeToRadius(Math.fround(9.1)));
    expect(attrs.filterValues.length).toBe(2 * FILTER_SIZE);
    expect(attrs.filterValues[0]).toBe(2011);
    expect(attrs.filterValues[FILTER_SIZE + 2]).toBe(UNKNOWN_DEPTH_FILTER);
    expect(attrs.filterValues[FILTER_SIZE + 3]).toBe(1);
    expect(Array.from(attrs.colors.slice(4, 8))).toEqual([138, 138, 138, 170]); // grey, unknown depth
  });
});
