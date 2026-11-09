import { describe, expect, it } from 'vitest';
import {
  DEPTH_STOPS,
  MAX_RADIUS,
  MIN_RADIUS,
  RADIUS_BASE,
  UNKNOWN_DEPTH_COLOR,
  depthToRgb,
  hexToRgb,
  magnitudeToRadius,
  zoomRadiusScale,
} from './scales';

const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('depth colour scale', () => {
  it('hits the stop colours exactly', () => {
    for (const stop of DEPTH_STOPS) expect(depthToRgb(stop.depth)).toEqual(hexToRgb(stop.color));
  });

  it('clamps outside the ramp', () => {
    expect(depthToRgb(-5)).toEqual(hexToRgb(DEPTH_STOPS[0].color));
    expect(depthToRgb(5000)).toEqual(hexToRgb(DEPTH_STOPS.at(-1)!.color));
  });

  it('gets darker with depth (bright shallow, dark deep)', () => {
    const samples = [0, 10, 35, 70, 150, 300, 600].map((d) => luminance(depthToRgb(d)));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
  });

  it('uses grey for unknown depth', () => {
    expect(depthToRgb(Number.NaN)).toEqual(hexToRgb(UNKNOWN_DEPTH_COLOR));
  });
});

describe('magnitude radius scale', () => {
  it('is exponential in magnitude', () => {
    expect(magnitudeToRadius(6) / magnitudeToRadius(5)).toBeCloseTo(RADIUS_BASE);
    expect(magnitudeToRadius(8) / magnitudeToRadius(6)).toBeCloseTo(RADIUS_BASE ** 2);
  });

  it('is clamped', () => {
    expect(magnitudeToRadius(-1)).toBe(MIN_RADIUS);
    expect(magnitudeToRadius(12)).toBe(MAX_RADIUS);
  });

  it('grows gently with zoom', () => {
    expect(zoomRadiusScale(1.5)).toBe(1);
    expect(zoomRadiusScale(6)).toBeGreaterThan(zoomRadiusScale(3));
    expect(zoomRadiusScale(20)).toBe(4);
  });
});
