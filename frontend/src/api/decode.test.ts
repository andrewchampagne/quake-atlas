import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { decodeEvents, parseEventsHeaders } from './decode';

function payload(): Uint8Array {
  const table = tableFromArrays({
    rid: new Uint32Array([4, 7]),
    time: new Float64Array([Date.UTC(2004, 11, 26), -14_000_000_000_000]),
    lon: new Float32Array([95.9, 22.4]),
    lat: new Float32Array([3.3, 37.1]),
    depth_km: new Float32Array([30, Number.NaN]),
    magnitude: new Float32Array([9.1, 7.2]),
    source: new Uint8Array([0, 1]),
  });
  return tableToIPC(table, 'stream');
}

describe('decodeEvents', () => {
  it('decodes an Arrow IPC stream into typed arrays', () => {
    const cols = decodeEvents(payload());
    expect(cols.length).toBe(2);
    expect(cols.rid).toBeInstanceOf(Uint32Array);
    expect(Array.from(cols.rid)).toEqual([4, 7]);
    expect(cols.time).toBeInstanceOf(Float64Array);
    expect(cols.time[1]).toBe(-14_000_000_000_000); // BCE instants survive
    expect(cols.depth[0]).toBe(30);
    expect(Number.isNaN(cols.depth[1])).toBe(true);
    expect(cols.source).toBeInstanceOf(Uint8Array);
  });

  it('reads family roles, and treats payloads without them as unclassified', () => {
    expect(Array.from(decodeEvents(payload()).role)).toEqual([0, 0]);
    const table = tableFromArrays({
      rid: new Uint32Array([4]),
      time: new Float64Array([0]),
      lon: new Float32Array([0]),
      lat: new Float32Array([0]),
      depth_km: new Float32Array([10]),
      magnitude: new Float32Array([6]),
      source: new Uint8Array([0]),
      role: new Uint8Array([4]),
    });
    expect(Array.from(decodeEvents(tableToIPC(table, 'stream')).role)).toEqual([4]);
  });

  it('rejects payloads with missing or mistyped columns', () => {
    const missing = tableToIPC(tableFromArrays({ rid: new Uint32Array([1]) }), 'stream');
    expect(() => decodeEvents(missing)).toThrow(/missing column "time"/);
    const wrong = tableToIPC(
      tableFromArrays({
        rid: new Float64Array([1]),
        time: new Float64Array([0]),
        lon: new Float32Array([0]),
        lat: new Float32Array([0]),
        depth_km: new Float32Array([0]),
        magnitude: new Float32Array([0]),
        source: new Uint8Array([0]),
      }),
      'stream',
    );
    expect(() => decodeEvents(wrong)).toThrow(/expected Uint32Array/);
  });

  it('handles an empty result', () => {
    const empty = tableToIPC(
      tableFromArrays({
        rid: new Uint32Array(0),
        time: new Float64Array(0),
        lon: new Float32Array(0),
        lat: new Float32Array(0),
        depth_km: new Float32Array(0),
        magnitude: new Float32Array(0),
        source: new Uint8Array(0),
      }),
      'stream',
    );
    expect(decodeEvents(empty).length).toBe(0);
  });
});

describe('parseEventsHeaders', () => {
  it('reads downsampling headers', () => {
    const h = new Headers({
      'X-Total-Count': '912345',
      'X-Returned-Count': '300000',
      'X-Downsampled': '1',
      'X-Min-Mag-Returned': '3.10',
    });
    expect(parseEventsHeaders(h, 0)).toEqual({
      total: 912_345,
      returned: 300_000,
      downsampled: true,
      minMagReturned: 3.1,
    });
  });

  it('falls back to the decoded length', () => {
    expect(parseEventsHeaders(new Headers(), 12)).toEqual({
      total: 12,
      returned: 12,
      downsampled: false,
      minMagReturned: null,
    });
  });
});
