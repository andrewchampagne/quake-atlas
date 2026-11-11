import { describe, expect, it } from 'vitest';
import type { EventColumns, Family, FamilyMembers } from '../api/types';
import { FILTERS, META, PLAYBACK } from '../test/fixtures';
import {
  buildTree,
  describeRole,
  familySegments,
  formatLogEta,
  isDependentRole,
  pathToRoot,
  ROLE_CODES,
} from './family';
import {
  covers,
  gpuFilterCategories,
  needsRefetch,
  summarizeEvents,
  toSearchParams,
  toServerQuery,
} from './filters';
import { forecastRows, formatDays, modelAt, observedAt } from './forecast';
import { yearStartMs } from './time';

/**
 * 10 (root, foreshock) ─┬─ 11 (mainshock) ─┬─ 13
 *                       │                  └─ 14 ── 15
 *                       └─ 12
 */
function members(): FamilyMembers {
  const t0 = Date.UTC(2011, 2, 9);
  return {
    rid: [10, 11, 12, 13, 14, 15],
    time: [0, 1, 2, 3, 4, 5].map((d) => t0 + d * 86_400_000),
    latitude: [38, 38.1, 38.2, 38.3, 38.4, 38.5],
    longitude: [179.5, 179.8, -179.9, 179, 178, -179.5],
    depth_km: [10, 29, null, 20, 30, 25],
    magnitude: [7.3, 9.1, 5.0, 6.0, 7.9, 5.5],
    parent_rid: [null, 10, 10, 11, 11, 14],
    generation: [0, 1, 1, 2, 2, 3],
    role: ['foreshock', 'mainshock', 'aftershock', 'aftershock', 'aftershock', 'aftershock'],
  };
}

function family(overrides: Partial<Family> = {}): Family {
  const m = members();
  return {
    rid: 15,
    role: 'aftershock',
    cluster_id: 10,
    size: 6,
    foreshocks: 1,
    aftershocks: 4,
    generations: [],
    mainshock: {
      rid: 11, event_id: 'us1', time: m.time[1], latitude: 38.1, longitude: 179.8,
      depth_km: 29, magnitude: 9.1, place: 'Near Tohoku',
    },
    root_rid: 10,
    start_time: m.time[0],
    end_time: m.time[5],
    neighbour: { rid: 14, log_eta: -8.5, log_t: -6, log_r: -2.5, linked: true, threshold: -5.75 },
    members: m,
    truncated: false,
    forecast_eligible: true,
    ...overrides,
  };
}

describe('family tree', () => {
  it('builds children in time order and counts descendants', () => {
    const tree = buildTree(members());
    expect(tree.roots).toEqual([0]);
    expect(tree.children[0]).toEqual([1, 2]);
    expect(tree.children[1]).toEqual([3, 4]);
    expect(tree.descendants).toEqual([5, 3, 0, 0, 1, 0]);
  });

  it('walks from the root to an event', () => {
    const m = members();
    const tree = buildTree(m);
    expect(pathToRoot(tree, m, 15)).toEqual([0, 1, 4, 5]);
    expect(pathToRoot(tree, m, 10)).toEqual([0]);
    expect(pathToRoot(tree, m, 999)).toEqual([]);
  });

  it('treats members whose parent is missing as extra roots', () => {
    const m = { ...members(), parent_rid: [null, 10, 10, 11, 77, 14] };
    expect(buildTree(m).roots).toEqual([0, 4]);
  });
});

describe('map segments', () => {
  it('draws one link per parent and marks the chain to the pinned event', () => {
    const segments = familySegments(family(), 15);
    expect(segments).toHaveLength(5);
    expect(segments.filter((s) => s.onPath)).toHaveLength(3); // 10→11, 11→14, 14→15
    expect(segments[0].year).toBeCloseTo(2011 + 68 / 365, 6); // child at 10 Mar 2011 00:00 UTC
  });

  it('takes the short way across the antimeridian', () => {
    const segments = familySegments(family(), 15);
    const toTwelve = segments[1]; // 179.5 → -179.9 should become 179.5 → 180.1
    expect(toTwelve.source[0]).toBe(179.5);
    expect(toTwelve.target[0]).toBeCloseTo(180.1, 6);
    const toFifteen = segments[4]; // 178 → -179.5 becomes 178 → 180.5
    expect(toFifteen.target[0]).toBeCloseTo(180.5, 6);
  });
});

describe('role text', () => {
  it('describes each role', () => {
    expect(describeRole(family())).toBe('Aftershock of the M 9.1 Near Tohoku (family of 6).');
    expect(describeRole(family({ role: 'mainshock' }))).toBe('Mainshock of a family of 6: 1 foreshock, 4 aftershocks.');
    expect(describeRole(family({ role: 'single', size: 1 }))).toMatch(/independent event/);
    expect(describeRole(family({ role: 'unclassified', mainshock: null }))).toMatch(/Historical records/);
    expect(formatLogEta(-5.751)).toBe('−5.75');
    expect(formatLogEta(null)).toBe('—');
  });

  it('flags foreshocks and aftershocks as dependent', () => {
    expect(Object.entries(ROLE_CODES).filter(([, code]) => isDependentRole(code)).map(([r]) => r)).toEqual([
      'foreshock',
      'aftershock',
    ]);
  });
});

describe('declustered filter', () => {
  it('reaches the server query and its parameters', () => {
    const q = toServerQuery({ ...FILTERS, declustered: true }, META);
    expect(q).toEqual({ declustered: true });
    expect(toSearchParams(q).toString()).toBe('declustered=true');
    expect(toServerQuery(FILTERS, META)).toEqual({});
  });

  it('is answered locally from a full catalog, never the reverse', () => {
    expect(covers({}, { declustered: true })).toBe(true);
    expect(covers({ declustered: true }, {})).toBe(false);
    expect(needsRefetch({ query: {}, downsampled: false }, { declustered: true })).toBe(false);
    expect(needsRefetch({ query: {}, downsampled: true }, { declustered: true })).toBe(true);
  });

  it('drops dependent events from local summaries and GPU categories', () => {
    const events: EventColumns = {
      length: 3,
      rid: new Uint32Array([1, 2, 3]),
      time: new Float64Array([yearStartMs(2001), yearStartMs(2002), yearStartMs(2003)]),
      lon: new Float32Array(3),
      lat: new Float32Array(3),
      depth: new Float32Array([10, 10, 10]),
      magnitude: new Float32Array([9, 7, 6]),
      source: new Uint8Array([0, 0, 0]),
      deaths: new Float32Array([Number.NaN, Number.NaN, Number.NaN]),
      role: new Uint8Array([ROLE_CODES.mainshock, ROLE_CODES.aftershock, ROLE_CODES.single]),
    };
    expect(summarizeEvents(events, FILTERS, META, PLAYBACK).total).toBe(3);
    const declustered = summarizeEvents(events, { ...FILTERS, declustered: true }, META, PLAYBACK);
    expect(declustered.total).toBe(2);
    expect(declustered.per_year.map((y) => y.year)).toEqual([2001, 2003]);
    expect(gpuFilterCategories(FILTERS)).toEqual([0, 1]);
    expect(gpuFilterCategories({ ...FILTERS, declustered: true })).toEqual([0]);
  });
});

describe('forecast shaping', () => {
  const forecast = {
    status: 'ok' as const,
    message: null,
    mainshock: family().mainshock!,
    fit_days: 3,
    horizon_days: 100,
    min_magnitude: 5,
    params: { k: 10, c_days: 0.05, p: 1.1, method: 'maximum-likelihood' as const },
    n_fit: 20,
    observed_after_fit: 15,
    expected_after_fit: 12,
    interval_after_fit: [6, 19] as [number, number],
    observed: [
      { days: 0.5, count: 1 },
      { days: 2, count: 20 },
      { days: 50, count: 35 },
    ],
    model: [
      { days: 0.1, expected: 2 },
      { days: 3, expected: 20 },
      { days: 10, expected: 26, lower: 22, upper: 30 },
      { days: 100, expected: 32, lower: 25, upper: 40 },
    ],
    notes: [],
  };

  it('merges observed steps and model points by day', () => {
    const rows = forecastRows(forecast);
    expect(rows.map((r) => r.days)).toEqual([0.1, 0.5, 2, 3, 10, 50, 100]);
    const atFit = rows.find((r) => r.days === 3)!;
    expect(atFit.fit).toBe(20);
    expect(atFit.forecast).toBe(20); // the dashed forecast starts where the fit ends
    expect(rows.find((r) => r.days === 10)!.band).toEqual([22, 30]);
    expect(rows.find((r) => r.days === 50)!.observed).toBe(35);
  });

  it('reads values for the tooltip', () => {
    expect(observedAt(forecast, 0.2)).toBe(0);
    expect(observedAt(forecast, 10)).toBe(20);
    expect(modelAt(forecast, 0.01)).toBeNull();
    const mid = modelAt(forecast, Math.sqrt(10 * 100))!; // halfway in log time
    expect(mid.expected).toBeCloseTo(29);
    expect(mid.lower).toBeCloseTo(23.5);
  });

  it('formats durations', () => {
    expect(formatDays(0.01)).toBe('14 min');
    expect(formatDays(0.1)).toBe('2 h');
    expect(formatDays(0.05)).toBe('1.2 h');
    expect(formatDays(3)).toBe('3 d');
    expect(formatDays(1000)).toBe('1,000 d');
  });
});
