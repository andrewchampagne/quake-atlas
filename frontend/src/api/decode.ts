import { tableFromIPC, type Table } from 'apache-arrow';
import type { EventColumns, EventsMeta } from './types';

type TypedArray = Uint32Array | Float64Array | Float32Array | Uint8Array;
type TypedArrayCtor<T extends TypedArray> = { new (length: number): T; name: string };

function column<T extends TypedArray>(table: Table, name: string, ctor: TypedArrayCtor<T>): T {
  const vector = table.getChild(name);
  if (!vector) throw new Error(`Events payload is missing column "${name}"`);
  const values = vector.toArray() as unknown;
  if (!(values instanceof ctor)) {
    throw new Error(`Column "${name}" decoded as ${String(values?.constructor?.name)}, expected ${ctor.name}`);
  }
  return values as T;
}

/** Decode the Arrow IPC stream returned by `GET /api/events` into typed arrays. */
export function decodeEvents(buffer: ArrayBuffer | Uint8Array): EventColumns {
  const table = tableFromIPC(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  return {
    length: table.numRows,
    rid: column(table, 'rid', Uint32Array),
    time: column(table, 'time', Float64Array),
    lon: column(table, 'lon', Float32Array),
    lat: column(table, 'lat', Float32Array),
    depth: column(table, 'depth_km', Float32Array),
    magnitude: column(table, 'magnitude', Float32Array),
    source: column(table, 'source', Uint8Array),
  };
}

/** Read the downsampling headers that accompany the events payload. */
export function parseEventsHeaders(headers: Headers, fallbackCount: number): EventsMeta {
  const num = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw == null || raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  return {
    total: num('X-Total-Count') ?? fallbackCount,
    returned: num('X-Returned-Count') ?? fallbackCount,
    downsampled: headers.get('X-Downsampled') === '1',
    minMagReturned: num('X-Min-Mag-Returned'),
  };
}
