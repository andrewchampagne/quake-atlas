export const MMI_LEVELS = [
  { mmi: 1, roman: 'I', label: 'Not felt', color: '#9ba6b5', rgb: [155, 166, 181] },
  { mmi: 2, roman: 'II', label: 'Weak', color: '#8cb6e9', rgb: [140, 182, 233] },
  { mmi: 3, roman: 'III', label: 'Weak', color: '#71b7e4', rgb: [113, 183, 228] },
  { mmi: 4, roman: 'IV', label: 'Light', color: '#65cfc0', rgb: [101, 207, 192] },
  { mmi: 5, roman: 'V', label: 'Moderate', color: '#9cd57c', rgb: [156, 213, 124] },
  { mmi: 6, roman: 'VI', label: 'Strong', color: '#e3cf63', rgb: [227, 207, 99] },
  { mmi: 7, roman: 'VII', label: 'Very strong', color: '#edaa55', rgb: [237, 170, 85] },
  { mmi: 8, roman: 'VIII', label: 'Severe', color: '#ef7951', rgb: [239, 121, 81] },
  { mmi: 9, roman: 'IX', label: 'Violent', color: '#e35b68', rgb: [227, 91, 104] },
  { mmi: 10, roman: 'X', label: 'Extreme', color: '#c779c9', rgb: [199, 121, 201] },
] as const;

export function intensity(value: number) {
  return MMI_LEVELS[Math.max(0, Math.min(9, Math.round(value) - 1))];
}

export const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value);
export const formatCompact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const formatProbability = (value: number) => `${(value * 100).toFixed(1)}%`;

/** MapLibre can return longitudes outside the canonical range in repeated worlds. */
export function wrapLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

/** Scenario limits accepted by the simulator (and validated by the API). */
export const MAGNITUDE_RANGE = [4, 9.5] as const;
export const DEPTH_RANGE = [1, 70] as const;
/** Magnitudes the shaking equation (Allen, Wald & Worden 2012) was fitted to. */
export const SUPPORTED_MAGNITUDE = [5, 7.9] as const;

export function isExtrapolatedMagnitude(magnitude: number): boolean {
  return magnitude < SUPPORTED_MAGNITUDE[0] || magnitude > SUPPORTED_MAGNITUDE[1] + 1e-9;
}
