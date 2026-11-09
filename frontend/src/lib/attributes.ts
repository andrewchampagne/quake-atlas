/**
 * Precompute the binary attributes deck.gl uploads to the GPU once per dataset.
 * Filters and playback then only change uniforms, so interaction stays at 60fps.
 */
import type { EventColumns } from '../api/types';
import { UNKNOWN_DEPTH_FILTER } from './filters';
import { depthToRgb, magnitudeToRadius, type RGB } from './scales';
import { msToDecimalYear } from './time';

export const FILTER_SIZE = 4;
/** Translucent fills so dense plate boundaries read as density instead of a solid band. */
const ALPHA = 170;

export interface GpuAttributes {
  /** Interleaved lon/lat. */
  positions: Float32Array;
  radii: Float32Array;
  /** RGBA, 0-255. */
  colors: Uint8Array;
  /** Interleaved [decimal year, magnitude, depth|-9999, source code]. */
  filterValues: Float32Array;
}

// Colour lookup per whole km avoids interpolating the ramp 300k times.
const LUT_MAX_KM = 800;
let depthLut: RGB[] | null = null;
function lutColor(depth: number): RGB {
  if (Number.isNaN(depth)) return depthToRgb(Number.NaN);
  depthLut ??= Array.from({ length: LUT_MAX_KM + 1 }, (_, km) => depthToRgb(km));
  const km = Math.round(depth);
  if (km < 0) return depthLut[0];
  return depthLut[Math.min(km, LUT_MAX_KM)];
}

export function buildAttributes(cols: EventColumns): GpuAttributes {
  const n = cols.length;
  const positions = new Float32Array(n * 2);
  const radii = new Float32Array(n);
  const colors = new Uint8Array(n * 4);
  const filterValues = new Float32Array(n * FILTER_SIZE);
  for (let i = 0; i < n; i++) {
    positions[2 * i] = cols.lon[i];
    positions[2 * i + 1] = cols.lat[i];
    const mag = cols.magnitude[i];
    radii[i] = magnitudeToRadius(mag);
    const depth = cols.depth[i];
    const [r, g, b] = lutColor(depth);
    colors[4 * i] = r;
    colors[4 * i + 1] = g;
    colors[4 * i + 2] = b;
    colors[4 * i + 3] = ALPHA;
    const f = FILTER_SIZE * i;
    filterValues[f] = msToDecimalYear(cols.time[i]);
    filterValues[f + 1] = mag;
    filterValues[f + 2] = Number.isNaN(depth) ? UNKNOWN_DEPTH_FILTER : depth;
    filterValues[f + 3] = cols.source[i];
  }
  return { positions, radii, colors, filterValues };
}
