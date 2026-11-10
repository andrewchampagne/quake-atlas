import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDetail, Summary } from '../api/types';
import { buildAttributes } from '../lib/attributes';
import { yearStartMs } from '../lib/time';
import { useQuakeStore, type EventsData } from '../store/useQuakeStore';
import { FILTERS, META, PLAYBACK } from '../test/fixtures';
import { HoverTooltip } from './HoverTooltip';
import { PinnedEventCard } from './PinnedEventCard';
import { SummaryPanel } from './SummaryPanel';
import { useEventDetail } from './useEventDetail';

vi.mock('./YearChart', () => ({ YearChart: () => <div>Year chart</div> }));
vi.mock('./useEventDetail', () => ({ useEventDetail: vi.fn(() => null) }));

const event: EventDetail = {
  rid: 1, event_id: 'noaa:1', time: yearStartMs(2001), time_label: '1 Jan 2001', year: 2001,
  latitude: 3, longitude: 4, depth_km: 10, magnitude: 8, mag_type: null,
  source: 'noaa', place: 'Test location', url: null, deaths: 1234, deaths_order: null,
};
const summary: Summary = {
  total: 2, total_deaths: 1234, deadly_events: 2, approx_deadly_events: 1,
  strongest: event, deadliest: event, per_year: [{ year: 2001, count: 2, deaths: 1234 }],
};

function loaded(value: number): EventsData {
  const columns = {
    length: 1, rid: new Uint32Array([1]), time: new Float64Array([event.time]),
    lon: new Float32Array([4]), lat: new Float32Array([3]), depth: new Float32Array([10]),
    magnitude: new Float32Array([8]), source: new Uint8Array([1]), deaths: new Float32Array([value]),
  };
  return {
    ...columns, ...buildAttributes(columns), total: 1, returned: 1,
    downsampled: false, minMagReturned: 8, query: {},
  };
}

beforeEach(() => {
  useQuakeStore.setState(useQuakeStore.getInitialState(), true);
  useQuakeStore.setState({ meta: META, filters: FILTERS, summary, summaryStatus: 'ready', playback: PLAYBACK });
  vi.mocked(useEventDetail).mockReturnValue(null);
});
afterEach(cleanup);

describe('summary death statistics', () => {
  it('displays server totals, explains ranges, and pins the deadliest event', () => {
    render(<SummaryPanel />);
    expect(screen.getByText('Recorded deaths (exact counts)').nextElementSibling?.textContent).toBe('1,234');
    expect(screen.getByText('Events with recorded deaths').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText(/1 events have approximate ranges only/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Deadliest recorded event/ }));
    expect(useQuakeStore.getState().pinned?.rid).toBe(1);
    expect(useQuakeStore.getState().flyTarget).toMatchObject({ longitude: 4, latitude: 3 });
  });

  it('uses complete local data in the playback window and retains full totals for downsampled data', () => {
    useQuakeStore.setState({ events: loaded(0), playback: { ...PLAYBACK, windowEnabled: true } });
    const view = render(<SummaryPanel />);
    expect(screen.getByText('Earthquakes in time window')).toBeTruthy();
    expect(screen.getByText('Recorded deaths (exact counts)').nextElementSibling?.textContent).toBe('0');
    expect(screen.queryByText('Deadliest recorded event')).toBeNull();
    view.unmount();
    useQuakeStore.setState({ events: { ...loaded(0), downsampled: true } });
    render(<SummaryPanel />);
    expect(screen.getByText('Recorded deaths (exact counts)').nextElementSibling?.textContent).toBe('1,234');
    expect(screen.getByText(/Statistics cover the full filter period/)).toBeTruthy();
  });

  it('uses a placeholder for absent stats, and zero with no enabled sources', () => {
    useQuakeStore.setState({ summary: { total: 0, strongest: null, per_year: [] } });
    const view = render(<SummaryPanel />);
    expect(screen.getByText('Recorded deaths (exact counts)').nextElementSibling?.textContent).toBe('—');
    view.unmount();
    useQuakeStore.setState({ filters: { ...FILTERS, sources: [] } });
    render(<SummaryPanel />);
    expect(screen.getByText('Recorded deaths (exact counts)').nextElementSibling?.textContent).toBe('0');
  });
});

describe('pinned and hover death details', () => {
  it.each([
    [0, '0 (none recorded)'],
    [Number.NaN, 'Unknown'],
    [-3, 'About 101–1,000 (approximate)'],
  ])('shows encoded %s consistently before details load', (value, expected) => {
    useQuakeStore.setState({
      events: loaded(value), pinned: { rid: 1, longitude: 4, latitude: 3, magnitude: 8 },
      hover: { index: 0, x: 100, y: 100 },
    });
    render(<><PinnedEventCard /><HoverTooltip /></>);
    expect(screen.getAllByText(expected)).toHaveLength(2);
  });

  it('prefers structured detail fields over the compact column and a conflicting legacy label', () => {
    useQuakeStore.setState({
      events: loaded(0), pinned: { rid: 1, longitude: 4, latitude: 3, magnitude: 8 },
      hover: { index: 0, x: 100, y: 100 },
    });
    vi.mocked(useEventDetail).mockReturnValue({ ...event, deaths: null, deaths_label: 'None recorded' });
    render(<><PinnedEventCard /><HoverTooltip /></>);
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
  });
});
