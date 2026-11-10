import { afterEach, describe, expect, it, vi } from 'vitest';
import { simulate } from './client';

const INPUT = { latitude: 0, longitude: -180, magnitude: 5, depth_km: 1 };
afterEach(() => vi.unstubAllGlobals());

describe('simulator client', () => {
  it('posts the exact scenario contract and forwards cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ input: INPUT })));
    vi.stubGlobal('fetch', fetchMock);
    await simulate(INPUT, controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/simulate'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(INPUT), signal: controller.signal,
    });
  });

  it('explains how to prepare missing simulator assets on HTTP 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
    await expect(simulate(INPUT)).rejects.toThrow('uv run quakes prepare-simulator');
  });

  it('turns a network failure into an actionable connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(simulate(INPUT)).rejects.toThrow('Check that the backend is running');
  });
});
