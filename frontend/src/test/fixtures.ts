import type { Meta } from '../api/types';
import type { Filters, Playback } from '../lib/filters';

export const META: Meta = {
  min_time: -888_635 * 86_400_000,
  max_time: Date.UTC(2024, 11, 31),
  min_year: -2149,
  max_year: 2024,
  magnitude: { min: 3.0, max: 9.1 },
  depth: { min: -3.2, max: 680.4 },
  sources: [
    { id: 'usgs', code: 0, label: 'USGS ComCat', count: 44_333 },
    { id: 'noaa', code: 1, label: 'NOAA', count: 1_110 },
  ],
  total: 45_443,
  max_points: 300_000,
};

export const FILTERS: Filters = {
  yearRange: [-2149, 2024],
  magRange: [3.0, 9.1],
  depthRange: [-4, 681],
  sources: ['usgs', 'noaa'],
};

export const PLAYBACK: Playback = {
  windowEnabled: false,
  mode: 'rolling',
  windowStart: 2000,
  windowSize: 5,
  playing: false,
  speed: 1,
};
