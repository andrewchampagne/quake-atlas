/**
 * Visual encodings for the map.
 *
 * Depth → colour: a "semantic heat" ramp from bright yellow (shallow, usually the
 * most damaging) through orange and magenta to purple-blue (deep). Lightness
 * decreases monotonically with depth, which was checked against the dark basemap
 * (OKLCH L 0.95 → 0.50, adjacent ΔL ≥ 0.06, deepest stop ≥ 2.8:1 contrast).
 *
 * Magnitude → radius: exponential, so each magnitude unit multiplies the radius
 * by {@link RADIUS_BASE}. Great quakes stand out without small ones vanishing.
 */

export type RGB = [number, number, number];

export interface DepthStop {
  depth: number;
  color: string;
}

export const DEPTH_STOPS: readonly DepthStop[] = [
  { depth: 0, color: '#fff1a8' },
  { depth: 20, color: '#fcc845' },
  { depth: 50, color: '#fb8a45' },
  { depth: 100, color: '#ee5a82' },
  { depth: 250, color: '#a352e2' },
  { depth: 600, color: '#4349d0' },
];

/** Neutral grey (no chroma) for events whose depth is unknown. */
export const UNKNOWN_DEPTH_COLOR = '#8a8a8a';

export const RADIUS_AT_M5 = 3;
export const RADIUS_BASE = 1.8;
export const MIN_RADIUS = 0.9;
export const MAX_RADIUS = 60;

export function hexToRgb(hex: string): RGB {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const STOP_RGB = DEPTH_STOPS.map((s) => ({ depth: s.depth, rgb: hexToRgb(s.color) }));
const UNKNOWN_RGB = hexToRgb(UNKNOWN_DEPTH_COLOR);

/** Colour for a depth in km. `NaN` (unknown) maps to grey; values clamp to the ramp ends. */
export function depthToRgb(depth: number): RGB {
  if (Number.isNaN(depth)) return UNKNOWN_RGB;
  if (depth <= STOP_RGB[0].depth) return STOP_RGB[0].rgb;
  for (let i = 1; i < STOP_RGB.length; i++) {
    const hi = STOP_RGB[i];
    if (depth <= hi.depth) {
      const lo = STOP_RGB[i - 1];
      const t = (depth - lo.depth) / (hi.depth - lo.depth);
      return [0, 1, 2].map((c) => Math.round(lo.rgb[c] + (hi.rgb[c] - lo.rgb[c]) * t)) as RGB;
    }
  }
  return STOP_RGB[STOP_RGB.length - 1].rgb;
}

/** Point radius in pixels (before zoom scaling) for a magnitude. */
export function magnitudeToRadius(magnitude: number): number {
  const r = RADIUS_AT_M5 * RADIUS_BASE ** (magnitude - 5);
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));
}

/** Gentle growth of point size with zoom so dense regions separate as you zoom in. */
export function zoomRadiusScale(zoom: number): number {
  return Math.min(4, Math.max(0.6, 1.3 ** (zoom - 1.5)));
}

/** CSS gradient matching the ramp with stops evenly spaced (as drawn in the legend). */
export function depthGradientCss(direction = 'to right'): string {
  const n = DEPTH_STOPS.length - 1;
  const parts = DEPTH_STOPS.map((s, i) => `${s.color} ${((i / n) * 100).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${parts.join(', ')})`;
}
