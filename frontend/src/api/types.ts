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
  /** Optional for catalogs served by older backends. */
  deadly_events?: number;
  simulator_ready?: boolean;
}

/** Missing fields are unknown (older catalogs); zero is an explicit recorded value. */
export interface DeathToll {
  deaths?: number | null;
  /** NOAA: 0 none, 1 = 1–50, 2 = 51–100, 3 = 101–1,000, 4 = >1,000. */
  deaths_order?: number | null;
}

export interface StrongestEvent extends DeathToll {
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
  /** Sum of exact recorded counts only. */
  deaths?: number;
}

export interface Summary {
  total: number;
  strongest: StrongestEvent | null;
  per_year: YearCount[];
  /** Sum of exact counts; approximate ranges and unknown tolls are excluded. */
  total_deaths?: number;
  /** Includes events with an exact positive count or a positive NOAA order. */
  deadly_events?: number;
  approx_deadly_events?: number;
  deadliest?: StrongestEvent | null;
}

export interface EventDetail extends DeathToll {
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
  deaths_label?: string;
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
  deadlyOnly?: boolean;
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
  /** Exact count >= 0; -1..-4 = NOAA order; NaN = unknown. Absent in legacy data. */
  deaths?: Float32Array;
}

export interface EventsMeta {
  total: number;
  returned: number;
  downsampled: boolean;
  minMagReturned: number | null;
}
