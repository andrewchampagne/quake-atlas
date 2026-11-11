import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDetail, Summary } from '../../api/types';
import { buildAttributes } from '../../lib/attributes';
import { yearStartMs } from '../../lib/time';
import { useQuakeStore, type EventsData } from '../../store/useQuakeStore';
import { FILTERS, META, PLAYBACK } from '../../test/fixtures';
import { HoverTooltip } from '../HoverTooltip';
import { useEventDetail } from '../useEventDetail';
import { EventPanel } from './EventPanel';
import { Inspector } from './Inspector';
import { OverviewPanel } from './OverviewPanel';

vi.mock('../useEventDetail', () => ({ useEventDetail: vi.fn(() => null) }));

const event: EventDetail = {
  rid: 1, event_id: 'noaa:1', time: yearStartMs(2001), time_label: '1 Jan 2001', year: 2001,
  latitude: 3, longitude: 4, depth_km: 10, magnitude: 8, mag_type: null,
  source: 'noaa', place: 'Test location', url: null, deaths: 1234, deaths_order: null,
};
const summary: Summary = {
  total: 2, total_deaths: 1234, deadly_events: 2, approx_deadly_events: 1,
  strongest: event, deadliest: event, per_year: [{ year: 2001, count: 2, deaths: 1234 }],
};
const PINNED = { rid: 1, longitude: 4, latitude: 3, magnitude: 8 };

function loaded(value: number): EventsData {
  const columns = {
    length: 1, rid: new Uint32Array([1]), time: new Float64Array([event.time]),
    lon: new Float32Array([4]), lat: new Float32Array([3]), depth: new Float32Array([10]),
    magnitude: new Float32Array([8]), source: new Uint8Array([1]), deaths: new Float32Array([value]),
    role: new Uint8Array([0]),
  };
  return {
    ...columns, ...buildAttributes(columns), total: 1, returned: 1,
    downsampled: false, minMagReturned: 8, query: {},
  };
}

const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

beforeEach(() => {
  useQuakeStore.setState(useQuakeStore.getInitialState(), true);
  useQuakeStore.setState({ meta: META, filters: FILTERS, summary, summaryStatus: 'ready', playback: PLAYBACK });
  vi.mocked(useEventDetail).mockReturnValue(null);
});
afterEach(cleanup);

describe('overview', () => {
  it('shows server totals, explains ranges, and selects notable events', () => {
    render(<OverviewPanel />);
    expect(stat('Earthquakes shown')).toBe('2');
    expect(stat('Recorded deaths')).toBe('1,234');
    expect(stat('Deadly events')).toBe('2');
    expect(screen.getByText(/1 more have only approximate tolls/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Deadliest recorded/ }));
    expect(useQuakeStore.getState().pinned?.rid).toBe(1);
    expect(useQuakeStore.getState().flyTarget).toMatchObject({ longitude: 4, latitude: 3 });
  });

  it('uses complete local data inside the playback window, and full totals when downsampled', () => {
    useQuakeStore.setState({ events: loaded(0), playback: { ...PLAYBACK, windowEnabled: true } });
    const view = render(<OverviewPanel />);
    expect(screen.getByText('Earthquakes in this window')).toBeTruthy();
    expect(stat('Recorded deaths')).toBe('0');
    expect(screen.queryByText('Deadliest recorded')).toBeNull();
    view.unmount();
    useQuakeStore.setState({ events: { ...loaded(0), downsampled: true } });
    render(<OverviewPanel />);
    expect(stat('Recorded deaths')).toBe('1,234');
    expect(screen.getByText(/Totals cover the whole range/)).toBeTruthy();
    expect(screen.getByText(/strongest of/)).toBeTruthy();
  });

  it('reports an empty selection, including when every source is off', () => {
    useQuakeStore.setState({ summary: { total: 0, strongest: null, per_year: [] } });
    const view = render(<OverviewPanel />);
    expect(screen.getByText(/No earthquakes match/)).toBeTruthy();
    view.unmount();
    useQuakeStore.setState({ summary, filters: { ...FILTERS, sources: [] } });
    render(<OverviewPanel />);
    expect(stat('Earthquakes shown')).toBe('0');
  });

  it('lists events by period and focuses one on click', () => {
    useQuakeStore.getState().setFilters({ yearRange: [2000, 2010] });
    render(<OverviewPanel />);
    fireEvent.click(screen.getByText('Events by period'));
    fireEvent.click(screen.getByText('2001'));
    expect(useQuakeStore.getState().playback).toMatchObject({ windowEnabled: true, windowStart: 2001, windowSize: 1 });
  });
});

describe('inspector', () => {
  it('shows the overview until an event is selected, and can be hidden', () => {
    render(<Inspector />);
    expect(screen.getByRole('complementary', { name: 'Overview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(useQuakeStore.getState().inspectorCollapsed).toBe(true);
    expect(screen.getByRole('button', { name: /Show overview/ })).toBeTruthy();
  });

  it('switches to the selected earthquake and back', () => {
    useQuakeStore.setState({ pinned: PINNED });
    render(<Inspector />);
    expect(screen.getByRole('complementary', { name: 'Selected earthquake' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /All earthquakes/ }));
    expect(useQuakeStore.getState().pinned).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Overview' })).toBeTruthy();
  });
});

describe('death tolls for the selected and hovered event', () => {
  it.each([
    [0, '0 (none recorded)'],
    [Number.NaN, 'Unknown'],
    [-3, 'About 101–1,000 (approximate)'],
  ])('shows encoded %s consistently before details load', (value, expected) => {
    useQuakeStore.setState({ events: loaded(value), pinned: PINNED, hover: { index: 0, x: 100, y: 100 } });
    render(<><EventPanel pinned={PINNED} /><HoverTooltip /></>);
    expect(screen.getAllByText(expected)).toHaveLength(2);
  });

  it('prefers structured detail fields over the compact column and a conflicting legacy label', () => {
    useQuakeStore.setState({ events: loaded(0), pinned: PINNED, hover: { index: 0, x: 100, y: 100 } });
    vi.mocked(useEventDetail).mockReturnValue({ ...event, deaths: null, deaths_label: 'None recorded' });
    render(<><EventPanel pinned={PINNED} /><HoverTooltip /></>);
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
  });
});
