const countFormat = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** `45,443` */
export function formatCount(n: number): string {
  return countFormat.format(n);
}

/** `45.4K` (use on axes, never on headline figures). */
export function formatCompact(n: number): string {
  return compactFormat.format(n);
}

/** `M 7.2` */
export function formatMagnitude(mag: number, magType?: string | null): string {
  const base = `M ${mag.toFixed(1)}`;
  return magType ? `${base} (${magType})` : base;
}

/** `29 km`, `unknown depth` */
export function formatDepth(depth: number | null | undefined): string {
  if (depth == null || Number.isNaN(depth)) return 'unknown depth';
  return `${depth < 10 ? depth.toFixed(1) : Math.round(depth)} km`;
}

/** `38.30°N, 142.37°E` */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}
