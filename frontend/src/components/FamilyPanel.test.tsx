import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Family } from '../api/types';
import { useQuakeStore } from '../store/useQuakeStore';
import { FILTERS, META, PLAYBACK } from '../test/fixtures';
import { FamilyPanel } from './FamilyPanel';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  fetchFamilyStats: vi.fn(() => new Promise(() => undefined)),
  fetchForecast: vi.fn(() => new Promise(() => undefined)),
}));

const T0 = Date.UTC(2011, 2, 9, 2, 45);
const HOUR = 3_600_000;

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
    pinned: { rid: 3, longitude: 142, latitude: 38.5, magnitude: 7.9 },
    family: FAMILY,
    familyStatus: 'ready',
    familyPanelOpen: true,
  });
});
afterEach(cleanup);

describe('FamilyPanel', () => {
  it('summarises the family and explains the pinned link', () => {
    render(<FamilyPanel />);
    expect(screen.getByText('M 9.1 mainshock')).toBeTruthy();
    expect(screen.getByText('Near Tohoku')).toBeTruthy();
    expect(screen.getByText('Foreshocks').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText(/log₁₀ η = −9.12, below the threshold of −5.75/)).toBeTruthy();
    expect(screen.getByText('Aftershock forecast (retrospective)')).toBeTruthy();
  });

  it('expands the chain to the pinned event and pins tree nodes on click', () => {
    render(<FamilyPanel />);
    const tree = screen.getByRole('tree');
    // Root, mainshock and both aftershocks are visible because the pin sits two levels down.
    expect(tree.querySelectorAll('[role=treeitem]')).toHaveLength(4);
    expect(tree.querySelector('[aria-selected=true]')?.textContent).toContain('M 7.9');
    fireEvent.click(screen.getByTitle('Foreshock, generation 0'));
    expect(useQuakeStore.getState().pinned?.rid).toBe(1);
    expect(useQuakeStore.getState().flyTarget).toMatchObject({ longitude: 143, latitude: 38 });
  });

  it('collapses a branch', () => {
    render(<FamilyPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse 2 direct children' }));
    expect(screen.getByRole('tree').querySelectorAll('[role=treeitem]')).toHaveLength(2);
  });

  it('closes back to the summary', () => {
    render(<FamilyPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Close family panel/ }));
    expect(useQuakeStore.getState().familyPanelOpen).toBe(false);
  });

  it('waits for the family of a newly pinned event', () => {
    useQuakeStore.setState({ pinned: { rid: 99, longitude: 0, latitude: 0, magnitude: 5 }, familyStatus: 'loading' });
    render(<FamilyPanel />);
    expect(screen.getByText('Loading family…')).toBeTruthy();
  });
});

describe('store', () => {
  it('unpinning clears the family and closes the panel', () => {
    useQuakeStore.getState().pin(null);
    const s = useQuakeStore.getState();
    expect(s.family).toBeNull();
    expect(s.familyPanelOpen).toBe(false);
  });
});
