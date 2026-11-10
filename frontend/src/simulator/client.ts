import type { PlaceResult, Simulation, SimulationInput } from './types';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class SimulationApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'SimulationApiError';
  }
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new SimulationApiError(0, 'Cannot reach the simulator. Check that the backend is running, then try again.');
  }
  if (!response.ok) {
    let detail = `Simulation request failed (HTTP ${response.status}). Please try again.`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (response.status === 422) detail = 'The scenario was rejected. Check the coordinates, magnitude, and depth.';
    } catch { /* The server may return a non-JSON error page. */ }
    if (response.status === 503) {
      detail = 'Simulator data is not ready. In the backend directory, run: uv run quakes prepare-simulator. When it finishes, try again.';
    }
    throw new SimulationApiError(response.status, detail);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new SimulationApiError(response.status, 'The simulator returned an unreadable response. Please try again.');
  }
}

export function simulate(input: SimulationInput, signal?: AbortSignal): Promise<Simulation> {
  return request('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

/** Search places by name for the location bar. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const response = await fetch(`${BASE}/api/geocode?${new URLSearchParams({ q: query })}`, { signal });
  if (!response.ok) throw new SimulationApiError(response.status, 'Place search is unavailable right now.');
  return await response.json() as PlaceResult[];
}
