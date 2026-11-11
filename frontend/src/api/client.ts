/** Typed client for the Quakes API. */
import { toSearchParams } from '../lib/filters';
import { decodeEvents, parseEventsHeaders } from './decode';
import type {
  AftershockForecast,
  EventColumns,
  EventDetail,
  EventsMeta,
  Family,
  FamilyStats,
  Meta,
  ServerQuery,
  Summary,
} from './types';

/** Empty in dev (Vite proxies /api) and in production (same origin). */
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function url(path: string, params?: URLSearchParams): string {
  const qs = params?.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function request(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url(path, params), { signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(0, 'Cannot reach the API server. Is the backend running on port 8000?');
  }
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(resp.status, detail || `HTTP ${resp.status}`);
  }
  return resp;
}

async function getJson<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  return (await request(path, params, signal)).json() as Promise<T>;
}

export function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  return getJson<Meta>('/api/meta', undefined, signal);
}

export function fetchSummary(query: ServerQuery, signal?: AbortSignal): Promise<Summary> {
  return getJson<Summary>('/api/summary', toSearchParams(query), signal);
}

export async function fetchEvents(
  query: ServerQuery,
  signal?: AbortSignal,
): Promise<{ columns: EventColumns; meta: EventsMeta }> {
  const resp = await request('/api/events', toSearchParams(query), signal);
  const columns = decodeEvents(await resp.arrayBuffer());
  return { columns, meta: parseEventsHeaders(resp.headers, columns.length) };
}

const detailCache = new Map<number, Promise<EventDetail>>();

/** Event details, memoised per rid (successful lookups only). */
export function fetchEventDetail(rid: number): Promise<EventDetail> {
  let pending = detailCache.get(rid);
  if (!pending) {
    pending = getJson<EventDetail>(`/api/events/${rid}`);
    detailCache.set(rid, pending);
    pending.catch(() => detailCache.delete(rid));
  }
  return pending;
}

const familyCache = new Map<number, Promise<Family>>();

/** The family of an event (memoised per rid, successful lookups only). */
export function fetchFamily(rid: number): Promise<Family> {
  let pending = familyCache.get(rid);
  if (!pending) {
    pending = getJson<Family>(`/api/families/${rid}`);
    familyCache.set(rid, pending);
    pending.catch(() => familyCache.delete(rid));
  }
  return pending;
}

export function fetchFamilyStats(signal?: AbortSignal): Promise<FamilyStats> {
  return getJson<FamilyStats>('/api/families/stats', undefined, signal);
}

export function fetchForecast(
  rid: number,
  fitDays: number,
  horizonDays: number,
  signal?: AbortSignal,
): Promise<AftershockForecast> {
  const params = new URLSearchParams({ fit_days: String(fitDays), horizon_days: String(horizonDays) });
  return getJson<AftershockForecast>(`/api/families/${rid}/forecast`, params, signal);
}
