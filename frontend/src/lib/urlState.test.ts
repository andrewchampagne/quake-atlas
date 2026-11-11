import { describe, expect, it } from 'vitest';
import { FILTERS, META, PLAYBACK } from '../test/fixtures';
import { filtersFromUrl, parseHash, serializeHash, urlStateFrom } from './urlState';

describe('hash parsing', () => {
  it('reads the view and every parameter', () => {
    expect(parseHash('#/explore?y=-463..2024&m=6..9.1&d=0..70&src=usgs&dc=1&e=21169&tab=family&w=-100.5..5&acc=1')).toEqual({
      view: 'explore',
      years: [-463, 2024],
      mag: [6, 9.1],
      depth: [0, 70],
      sources: ['usgs'],
      declustered: true,
      event: 21169,
      tab: 'family',
      window: { start: -100.5, size: 5, cumulative: true },
    });
    expect(parseHash('#/simulate').view).toBe('simulate');
    expect(parseHash('').view).toBe('explore');
  });

  it('ignores malformed values', () => {
    expect(parseHash('#/explore?y=2024..2000&m=abc&e=-4&tab=nope&w=2000..0')).toEqual({ view: 'explore' });
  });

  it('round-trips', () => {
    const hash = '#/explore?y=1900..2024&src=noaa,usgs&e=7&tab=forecast&w=1990..5';
    expect(serializeHash(parseHash(hash))).toBe(hash);
    expect(serializeHash({ view: 'explore' })).toBe('#/explore');
  });
});

describe('state ↔ URL', () => {
  it('omits defaults', () => {
    const state = urlStateFrom({ view: 'explore', filters: FILTERS, meta: META, playback: PLAYBACK, event: null, tab: 'details' });
    expect(serializeHash(state)).toBe('#/explore');
  });

  it('writes narrowed filters, the selection, its tab and the window', () => {
    const state = urlStateFrom({
      view: 'explore',
      filters: { ...FILTERS, yearRange: [2000, 2024], magRange: [6, 9.1], sources: ['usgs'], declustered: true },
      meta: META,
      playback: { ...PLAYBACK, windowEnabled: true, windowStart: 2010.25, windowSize: 2 },
      event: 42,
      tab: 'family',
    });
    expect(serializeHash(state)).toBe('#/explore?y=2000..2024&m=6..9.1&src=usgs&dc=1&e=42&tab=family&w=2010.25..2');
  });

  it('drops the tab without a selection', () => {
    const state = urlStateFrom({ view: 'explore', filters: FILTERS, meta: META, playback: PLAYBACK, event: null, tab: 'family' });
    expect(state.tab).toBeUndefined();
  });

  it('clamps URL filters to the dataset and ignores unknown sources', () => {
    const f = filtersFromUrl(
      { view: 'explore', years: [-9999, 3000], mag: [1, 7], depth: [-50, 70], sources: ['usgs', 'isc'], declustered: true },
      { ...META, families_ready: true },
    );
    expect(f.yearRange).toEqual([META.min_year, META.max_year]);
    expect(f.magRange).toEqual([3, 7]);
    expect(f.depthRange).toEqual([-4, 70]);
    expect(f.sources).toEqual(['usgs']);
    expect(f.declustered).toBe(true);
    expect(filtersFromUrl({ view: 'explore', declustered: true }, META).declustered).toBe(false); // no families built
  });
});
