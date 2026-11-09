/** Types mirroring the FastAPI response models (backend/src/quakes/models.py). */

export interface Range {
  min: number;
  max: number;
}

export interface SourceInfo {
  id: string;
  /** uint8 code used in the binary events payload. */
  code: number;
  label: string;
  count: number;
}

export interface Meta {
  min_time: number;
  max_time: number;
  min_year: number;
  max_year: number;
  magnitude: Range;
  depth: Range;
  sources: SourceInfo[];
  total: number;
  max_points: number;
}

export interface StrongestEvent {
  rid: number;
  event_id: string;
  time: number;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number;
  place: string | null;
  source: string;
}

export interface YearCount {
  year: number;
  count: number;
}

export interface Summary {
  total: number;
  strongest: StrongestEvent | null;
  per_year: YearCount[];
}

export interface EventDetail {
  rid: number;
  event_id: string;
  time: number;
  time_label: string;
  year: number;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number;
  mag_type: string | null;
  place: string | null;
  source: string;
  url: string | null;
}

/** Server-side filter parameters. `undefined` = unbounded. */
export interface ServerQuery {
  start?: number;
  end?: number;
  minMag?: number;
  maxMag?: number;
  minDepth?: number;
  maxDepth?: number;
  /** `undefined` = all sources. */
  sources?: string[];
}

/** Columns decoded from the Arrow payload (zero-copy typed arrays where possible). */
export interface EventColumns {
  length: number;
  rid: Uint32Array;
  /** Epoch milliseconds. */
  time: Float64Array;
  lon: Float32Array;
  lat: Float32Array;
  /** km; NaN = unknown. */
  depth: Float32Array;
  magnitude: Float32Array;
  source: Uint8Array;
}

export interface EventsMeta {
  total: number;
  returned: number;
  downsampled: boolean;
  minMagReturned: number | null;
}
