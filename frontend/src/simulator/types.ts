/** Mirrors backend/src/quakes/models.py; isolated from the explorer API. */
export interface SimulationInput {
  latitude: number;
  longitude: number;
  magnitude: number;
  depth_km: number;
}

export interface ShakingRing {
  mmi: number;
  radius_km: number;
}

export interface ExposureLevel {
  mmi: number;
  population: number;
}

export interface CityImpact {
  name: string;
  country: string | null;
  population: number;
  distance_km: number;
  mmi: number;
}

export interface FatalityBin {
  key: string;
  label: string;
  probability: number;
}

export interface FatalityEstimate {
  bins: FatalityBin[];
  exceedance: Record<string, number>;
  median_bin: string;
  median_label: string;
  alert: string;
}

export interface Analog {
  rid: number;
  event_id: string;
  time: number;
  year: number;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number;
  place: string | null;
  source: string;
  deaths: number | null;
  deaths_order: number | null;
  deaths_label: string;
  distance_km: number;
}

export interface AnalogSummary {
  radius_km: number;
  magnitude_window: number;
  count: number;
  deadly: number;
  max_deaths: number | null;
  events: Analog[];
}

export interface Recurrence {
  radius_km: number;
  magnitude: number;
  start_year: number;
  end_year: number;
  reference_magnitude: number;
  reference_count: number;
  count_at_or_above: number;
  rate_per_year: number | null;
  return_period_years: number | null;
  probability_50yr: number | null;
  method: string;
}

export interface ModelCard {
  trained_at: string;
  n_train: number;
  n_deadly: number;
  years: [number, number];
  min_magnitude: number;
  features: string[];
  metrics: Record<string, number | null>;
  baseline: Record<string, number | null>;
  notes: string[];
}

export interface Simulation {
  input: SimulationInput;
  epicentral_mmi: number;
  rings: ShakingRing[];
  exposure: ExposureLevel[];
  cities: CityImpact[];
  fatalities: FatalityEstimate;
  analogs: AnalogSummary;
  recurrence: Recurrence;
  model: ModelCard;
}

/** A place returned by GET /api/geocode. */
export interface PlaceResult {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  kind: string | null;
  /** 'photon' (OpenStreetMap) or 'local' (bundled city list, used offline). */
  source: string;
}
