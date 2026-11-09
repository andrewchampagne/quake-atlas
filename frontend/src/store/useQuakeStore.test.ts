import { beforeEach, describe, expect, it } from 'vitest';
import { FILTERS, META } from '../test/fixtures';
import { useQuakeStore } from './useQuakeStore';

function reset() {
  useQuakeStore.setState({ meta: META, metaStatus: 'ready', filters: FILTERS });
  useQuakeStore.getState().resetFilters();
}

describe('useQuakeStore', () => {
  beforeEach(reset);

  it('resets playback to proportionate defaults for the full range', () => {
    const { playback } = useQuakeStore.getState();
    expect(playback.windowEnabled).toBe(false);
    expect(playback.speed).toBe(100);
    expect(playback.windowStart).toBe(META.min_year);
  });

  it('rescales speed and window size when the date range changes', () => {
    useQuakeStore.getState().setFilters({ yearRange: [2000, 2024] });
    const { playback } = useQuakeStore.getState();
    expect(playback.speed).toBe(1);
    expect(playback.windowSize).toBe(1);
    expect(playback.windowStart).toBe(2000); // clamped into the new range
  });

  it('does not touch playback speed for non-date filters', () => {
    useQuakeStore.getState().setPlayback({ speed: 25 });
    useQuakeStore.getState().setFilters({ magRange: [6, 9.1] });
    expect(useQuakeStore.getState().playback.speed).toBe(25);
  });

  it('focusPeriod (chart bar click) opens a paused window on that period', () => {
    const s = useQuakeStore.getState();
    s.setFilters({ yearRange: [2000, 2024] });
    s.togglePlay();
    useQuakeStore.getState().focusPeriod(2011, 2012);
    const { playback } = useQuakeStore.getState();
    expect(playback).toMatchObject({ windowEnabled: true, playing: false, windowStart: 2011, windowSize: 1 });
  });

  it('tick advances only while playing', () => {
    const s = useQuakeStore.getState();
    s.setFilters({ yearRange: [2000, 2024] });
    useQuakeStore.getState().tick(1);
    expect(useQuakeStore.getState().playback.windowStart).toBe(2000);
    useQuakeStore.getState().togglePlay();
    useQuakeStore.getState().tick(0.5);
    expect(useQuakeStore.getState().playback.windowStart).toBeCloseTo(2000.5);
  });

  it('retry bumps the reload token and drops failed events', () => {
    useQuakeStore.setState({ eventsStatus: 'error', eventsError: 'boom' });
    const before = useQuakeStore.getState().reloadToken;
    useQuakeStore.getState().retry();
    expect(useQuakeStore.getState().reloadToken).toBe(before + 1);
    expect(useQuakeStore.getState().events).toBeNull();
  });
});
