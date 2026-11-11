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
  /** Earthquake families (nearest-neighbour clusters) have been built. */
  families_ready?: boolean;
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
  /** Drop foreshocks and aftershocks. */
  declustered?: boolean;
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
  /** Family role code (see `ROLE_CODES` in lib/family.ts); all 0 when families are not built. */
  role: Uint8Array;
}

export interface EventsMeta {
  total: number;
  returned: number;
  downsampled: boolean;
  minMagReturned: number | null;
}

// ------------------------------------------------------------------ families

export type FamilyRole = 'unclassified' | 'single' | 'mainshock' | 'foreshock' | 'aftershock';

export interface FamilyEvent {
  rid: number;
  event_id: string;
  time: number;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number;
  place: string | null;
}

/** Family members in time order, as parallel columns. */
export interface FamilyMembers {
  rid: number[];
  time: number[];
  latitude: number[];
  longitude: number[];
  depth_km: (number | null)[];
  magnitude: number[];
  /** Parent within this payload (nearest included ancestor when truncated). */
  parent_rid: (number | null)[];
  generation: number[];
  role: FamilyRole[];
}

export interface GenerationCount {
  generation: number;
  count: number;
  max_magnitude: number;
}

export interface NearestNeighbour {
  rid: number | null;
  log_eta: number | null;
  log_t: number | null;
  log_r: number | null;
  linked: boolean;
  threshold: number;
}

export interface Family {
  rid: number;
  role: FamilyRole;
  cluster_id: number | null;
  size: number;
  foreshocks: number;
  aftershocks: number;
  generations: GenerationCount[];
  mainshock: FamilyEvent | null;
  root_rid: number | null;
  start_time: number | null;
  end_time: number | null;
  neighbour: NearestNeighbour | null;
  members: FamilyMembers;
  truncated: boolean;
  forecast_eligible: boolean;
}

export interface Histogram2D {
  x_edges: number[];
  y_edges: number[];
  /** counts[i][j]: x bin i, y bin j. */
  counts: number[][];
}

export interface LargestFamily {
  mainshock: FamilyEvent;
  size: number;
  foreshocks: number;
  aftershocks: number;
}

export interface FamilyStats {
  threshold: number;
  threshold_method: string;
  b_value: number;
  fractal_dimension: number;
  q: number;
  log_eta_cap: number;
  r_min_km: number;
  min_magnitude: number | null;
  built_at: string;
  analysed: number;
  roles: Record<Exclude<FamilyRole, 'unclassified'>, number>;
  families: number;
  clustered_fraction: number;
  gmm: { means?: number[]; sds?: number[]; weights?: number[] };
  eta_histogram: { edges: number[]; counts: number[] };
  /** Nearest neighbours by rescaled time log10(T) (x) and distance log10(R) (y). */
  density: Histogram2D;
  largest: LargestFamily[];
}

export interface OmoriParameters {
  k: number;
  c_days: number;
  p: number;
  method: 'maximum-likelihood' | 'generic-shape';
}

export interface ForecastPoint {
  days: number;
  expected: number;
  lower?: number | null;
  upper?: number | null;
}

export interface AftershockForecast {
  status: 'ok' | 'too-few' | 'not-eligible' | 'too-recent';
  message: string | null;
  mainshock: FamilyEvent;
  fit_days: number;
  horizon_days: number;
  min_magnitude: number;
  params: OmoriParameters | null;
  n_fit: number;
  observed_after_fit: number;
  expected_after_fit: number | null;
  interval_after_fit: [number, number] | null;
  observed: { days: number; count: number }[];
  model: ForecastPoint[];
  notes: string[];
}
