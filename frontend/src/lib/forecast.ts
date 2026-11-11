/** Shaping a retrospective aftershock forecast for the chart and its tooltip. */
import type { AftershockForecast as Forecast } from '../api/types';
import { formatCount } from './format';

export interface ForecastRow {
  days: number;
  observed?: number;
  fit?: number;
  forecast?: number;
  band?: [number, number];
}

/** `15 min`, `2.4 h`, `3 d`, `1,000 d` */
export function formatDays(days: number): string {
  if (days < 1 / 24) return `${Math.round(days * 1440)} min`;
  if (days < 1) return `${(days * 24).toFixed(days < 0.1 ? 1 : 0)} h`;
  return `${formatCount(Math.round(days))} d`;
}

/** Merge observed steps and model points into one row set keyed by day. */
export function forecastRows(forecast: Forecast): ForecastRow[] {
  const rows = new Map<number, ForecastRow>();
  const row = (days: number) => {
    let r = rows.get(days);
    if (!r) rows.set(days, (r = { days }));
    return r;
  };
  for (const p of forecast.observed) row(p.days).observed = p.count;
  for (const p of forecast.model) {
    const r = row(p.days);
    if (p.days <= forecast.fit_days) r.fit = p.expected;
    if (p.days >= forecast.fit_days) {
      r.forecast = p.expected;
      r.band = p.lower != null && p.upper != null ? [p.lower, p.upper] : [p.expected, p.expected];
    }
  }
  return [...rows.values()].sort((a, b) => a.days - b.days);
}

/** Cumulative recorded aftershocks by `days` (step function over the observed points). */
export function observedAt(forecast: Forecast, days: number): number {
  let count = 0;
  for (const p of forecast.observed) {
    if (p.days > days) break;
    count = p.count;
  }
  return count;
}

/** Model value at `days`, interpolated in log time between model points. */
export function modelAt(forecast: Forecast, days: number): { expected: number; lower?: number; upper?: number } | null {
  const pts = forecast.model;
  if (pts.length === 0 || days < pts[0].days) return null;
  for (let k = 1; k < pts.length; k++) {
    if (pts[k].days >= days) {
      const a = pts[k - 1];
      const b = pts[k];
      const w = (Math.log(days) - Math.log(a.days)) / (Math.log(b.days) - Math.log(a.days) || 1);
      const mix = (u?: number | null, v?: number | null) => (u != null && v != null ? u + w * (v - u) : undefined);
      return { expected: mix(a.expected, b.expected)!, lower: mix(a.lower, b.lower), upper: mix(a.upper, b.upper) };
    }
  }
  return null;
}
