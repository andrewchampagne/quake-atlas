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

  it('steps and clears the playback window', () => {
    const s = useQuakeStore.getState();
    s.setFilters({ yearRange: [2000, 2024] });
    useQuakeStore.getState().setPlayback({ windowSize: 5 });
    useQuakeStore.getState().stepWindow(1);
    expect(useQuakeStore.getState().playback).toMatchObject({ windowEnabled: true, windowStart: 2000 });
    useQuakeStore.getState().stepWindow(1);
    expect(useQuakeStore.getState().playback.windowStart).toBe(2005);
    useQuakeStore.getState().stepWindow(-1);
    useQuakeStore.getState().stepWindow(-1);
    expect(useQuakeStore.getState().playback.windowStart).toBe(2000); // clamped at the start
    useQuakeStore.getState().clearWindow();
    expect(useQuakeStore.getState().playback).toMatchObject({ windowEnabled: false, playing: false });
    useQuakeStore.getState().stepWindow(-1); // from "all years", stepping back starts at the end
    expect(useQuakeStore.getState().playback.windowStart).toBe(2020);
  });

  it('keeps the inspector tab while moving between events, and resets it on deselect', () => {
    const event = { rid: 1, longitude: 0, latitude: 0, magnitude: 6 };
    useQuakeStore.getState().pin(event);
    useQuakeStore.getState().setInspectorTab('family');
    useQuakeStore.getState().pin({ ...event, rid: 2 });
    expect(useQuakeStore.getState().inspectorTab).toBe('family');
    useQuakeStore.getState().pin(null);
    expect(useQuakeStore.getState().inspectorTab).toBe('details');
  });

  it('reopens a collapsed inspector when an event is selected', () => {
    useQuakeStore.getState().setInspectorCollapsed(true);
    useQuakeStore.getState().pin({ rid: 1, longitude: 0, latitude: 0, magnitude: 6 });
    expect(useQuakeStore.getState().inspectorCollapsed).toBe(false);
  });

  it('retry bumps the reload token and drops failed events', () => {
    useQuakeStore.setState({ eventsStatus: 'error', eventsError: 'boom' });
    const before = useQuakeStore.getState().reloadToken;
    useQuakeStore.getState().retry();
    expect(useQuakeStore.getState().reloadToken).toBe(before + 1);
    expect(useQuakeStore.getState().events).toBeNull();
  });
});
