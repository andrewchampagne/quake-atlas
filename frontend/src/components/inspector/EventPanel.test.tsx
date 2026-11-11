import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Family } from '../../api/types';
import { useQuakeStore } from '../../store/useQuakeStore';
import { FILTERS, META, PLAYBACK } from '../../test/fixtures';
import { EventPanel } from './EventPanel';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  fetchFamilyStats: vi.fn(() => new Promise(() => undefined)),
  fetchForecast: vi.fn(() => new Promise(() => undefined)),
  fetchEventDetail: vi.fn(() => new Promise(() => undefined)),
}));

const T0 = Date.UTC(2011, 2, 9, 2, 45);
const HOUR = 3_600_000;
const PINNED = { rid: 3, longitude: 142, latitude: 38.5, magnitude: 7.9 };

const FAMILY: Family = {
  rid: 3,
  role: 'aftershock',
  cluster_id: 1,
  size: 4,
  foreshocks: 1,
  aftershocks: 2,
  generations: [
    { generation: 0, count: 1, max_magnitude: 7.3 },
    { generation: 1, count: 1, max_magnitude: 9.1 },
    { generation: 2, count: 2, max_magnitude: 7.9 },
  ],
  mainshock: {
    rid: 2, event_id: 'us2', time: T0 + 51 * HOUR, latitude: 38.3, longitude: 142.4,
    depth_km: 29, magnitude: 9.1, place: 'Near Tohoku',
  },
  root_rid: 1,
  start_time: T0,
  end_time: T0 + 60 * HOUR,
  neighbour: { rid: 2, log_eta: -9.12, log_t: -7, log_r: -2.12, linked: true, threshold: -5.75 },
  members: {
    rid: [1, 2, 3, 4],
    time: [T0, T0 + 51 * HOUR, T0 + 52 * HOUR, T0 + 60 * HOUR],
    latitude: [38, 38.3, 38.5, 37],
    longitude: [143, 142.4, 142, 141],
    depth_km: [10, 29, 20, 30],
    magnitude: [7.3, 9.1, 7.9, 6.1],
    parent_rid: [null, 1, 2, 2],
    generation: [0, 1, 2, 2],
    role: ['foreshock', 'mainshock', 'aftershock', 'aftershock'],
  },
  truncated: false,
  forecast_eligible: true,
};

beforeEach(() => {
  useQuakeStore.setState(useQuakeStore.getInitialState(), true);
  useQuakeStore.setState({
    meta: { ...META, families_ready: true },
    filters: FILTERS,
    playback: PLAYBACK,
    pinned: PINNED,
    family: FAMILY,
    familyStatus: 'ready',
    inspectorTab: 'family',
  });
});
afterEach(cleanup);

describe('EventPanel', () => {
  it('names the role and offers Details, Family and Forecast tabs', () => {
    render(<EventPanel pinned={PINNED} />);
    expect(screen.getByText('Aftershock of the M 9.1 Near Tohoku (family of 4).')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Details', 'Family4', 'Forecast']);
    expect(screen.getByRole('tab', { name: /Family/ }).getAttribute('data-state')).toBe('active');
  });

  it('explains the link and shows the tree with the chain to the selection expanded', () => {
    render(<EventPanel pinned={PINNED} />);
    expect(screen.getByText(/log₁₀ η = −9.12, below the threshold of −5.75/)).toBeTruthy();
    expect(screen.getByText('Foreshocks').nextElementSibling?.textContent).toBe('1');
    const tree = screen.getByRole('tree');
    expect(tree.querySelectorAll('[role=treeitem]')).toHaveLength(4);
    expect(tree.querySelector('[aria-selected=true]')?.textContent).toContain('M 7.9');
  });

  it('selects tree nodes and keeps the Family tab while moving through the family', () => {
    render(<EventPanel pinned={PINNED} />);
    fireEvent.click(screen.getByTitle('Foreshock, generation 0'));
    const s = useQuakeStore.getState();
    expect(s.pinned?.rid).toBe(1);
    expect(s.inspectorTab).toBe('family');
    expect(s.flyTarget).toMatchObject({ longitude: 143, latitude: 38 });
  });

  it('collapses a branch', () => {
    render(<EventPanel pinned={PINNED} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse 2 direct children' }));
    expect(screen.getByRole('tree').querySelectorAll('[role=treeitem]')).toHaveLength(2);
  });

  it('falls back to Details for an event without a family', () => {
    const single: Family = {
      ...FAMILY,
      role: 'single',
      size: 1,
      foreshocks: 0,
      aftershocks: 0,
      forecast_eligible: false,
      neighbour: { rid: 9, log_eta: -3.2, log_t: -1, log_r: -2.2, linked: false, threshold: -5.75 },
    };
    useQuakeStore.setState({ family: single });
    render(<EventPanel pinned={PINNED} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText(/too far away to be its parent/)).toBeTruthy();
    expect(screen.getByText('Recorded deaths')).toBeTruthy();
  });

  it('returns to the overview', () => {
    render(<EventPanel pinned={PINNED} />);
    fireEvent.click(screen.getByRole('button', { name: /All earthquakes/ }));
    const s = useQuakeStore.getState();
    expect(s.pinned).toBeNull();
    expect(s.family).toBeNull();
    expect(s.inspectorTab).toBe('details');
  });
});
