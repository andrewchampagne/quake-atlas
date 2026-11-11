import { describe, expect, it } from 'vitest';
import { FILTERS, META } from '../test/fixtures';
import { activeFilterChips } from './filters';
import { binHeight, layoutTicks, MIN_RATE, timelineBins } from './timelineBins';
import { makeYearScale } from './yearScale';

describe('timeline bins', () => {
  const scale = makeYearScale(-2149, 2025);
  const perYear = [
    { year: -463, count: 1 },
    { year: 1755, count: 1 },
    { year: 2011, count: 300 },
    { year: 2024, count: 100 },
  ];
  const bins = timelineBins(perYear, scale, -2149, 2025);

  it('tiles the whole span in whole years without gaps', () => {
    expect(bins[0].start).toBe(-2149);
    expect(bins.at(-1)!.end).toBe(2025);
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i].start).toBe(bins[i - 1].end);
      expect(bins[i].end).toBeGreaterThan(bins[i].start);
    }
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(402);
  });

  it('spends most of the track on the instrumental era', () => {
    const modern = bins.filter((b) => b.start >= 1900);
    expect(modern.length / bins.length).toBeGreaterThan(0.6);
    expect(Math.max(...modern.map((b) => b.end - b.start))).toBeLessThanOrEqual(2);
  });

  it('puts counts in the right bucket and turns them into rates', () => {
    const b2011 = bins.find((b) => b.start <= 2011 && b.end > 2011)!;
    expect(b2011.count).toBe(300);
    expect(b2011.rate).toBeCloseTo(300 / (b2011.end - b2011.start));
  });

  it('scales heights on a log axis with a floor', () => {
    const max = Math.max(...bins.map((b) => b.rate));
    const ancient = bins.find((b) => b.count === 1 && b.start < 0)!;
    expect(binHeight(ancient, max)).toBeGreaterThanOrEqual(0.06);
    expect(binHeight({ ...ancient, count: 0, rate: 0 }, max)).toBe(0);
    expect(binHeight({ ...ancient, rate: max }, max)).toBe(1);
    expect(binHeight({ ...ancient, rate: MIN_RATE / 10 }, max)).toBe(0.06);
  });
});

describe('tick layout', () => {
  const candidates = [
    { year: -2149, pos: 0, align: 'start' as const },
    { year: 1000, pos: 0.1, align: 'center' as const },
    { year: 1900, pos: 0.25, align: 'center' as const },
    { year: 2000, pos: 0.85, align: 'center' as const },
    { year: 2024, pos: 1, align: 'end' as const },
  ];

  it('keeps every tick when there is room', () => {
    expect(layoutTicks(candidates, 1200).map((t) => t.year)).toEqual([-2149, 1000, 1900, 2000, 2024]);
  });

  it('drops colliding middle ticks on narrow tracks but keeps both ends', () => {
    const kept = layoutTicks(candidates, 300).map((t) => t.year);
    expect(kept[0]).toBe(-2149);
    expect(kept.at(-1)).toBe(2024);
    expect(kept).not.toContain(1000);
  });
});

describe('active filter chips', () => {
  it('has none for the full dataset', () => {
    expect(activeFilterChips(FILTERS, META)).toEqual([]);
  });

  it('labels each narrowing filter and knows how to clear it', () => {
    const chips = activeFilterChips(
      { ...FILTERS, yearRange: [1900, 2024], magRange: [6, 9.1], depthRange: [0, 70], sources: ['noaa'], declustered: true },
      META,
    );
    expect(chips.map((c) => c.label)).toEqual(['1900 – 2024', 'M 6.0+', '0–70 km deep', 'NOAA only', 'No aftershocks']);
    expect(chips[1].clear).toEqual({ magRange: [3, 9.1] });
    expect(chips[3].clear).toEqual({ sources: ['usgs', 'noaa'] });
  });

  it('words open-ended and closed ranges differently', () => {
    const labels = (f: Partial<typeof FILTERS>) => activeFilterChips({ ...FILTERS, ...f }, META).map((c) => c.label);
    expect(labels({ magRange: [3, 5] })).toEqual(['Up to M 5.0']);
    expect(labels({ magRange: [5, 6] })).toEqual(['M 5.0–6.0']);
    expect(labels({ depthRange: [300, 681] })).toEqual(['300+ km deep']);
    expect(labels({ sources: [] })).toEqual(['No sources']);
  });
});
