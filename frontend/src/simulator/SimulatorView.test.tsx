import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces, simulate } from './client';
import SimulatorView from './SimulatorView';
import type { Simulation, SimulationInput } from './types';

vi.mock('./client', () => ({ simulate: vi.fn(), searchPlaces: vi.fn() }));
vi.mock('./SimulatorMap', () => ({
  default: ({ onPlace, result }: { onPlace: (lat: number, lon: number) => void; result: Simulation | null }) => <section aria-label="Scenario map">
    <button onClick={() => onPlace(-12.5, -179.9)}>Place epicenter</button>
    {result && <span>Shaking rings visible</span>}
  </section>,
}));

const ISTANBUL = { name: 'Istanbul', label: 'Istanbul, Türkiye', latitude: 41.0082, longitude: 28.9784, kind: 'city', source: 'photon' };

/** Type into the location search and pick the first suggestion. */
async function searchAndPick(text = 'Istan') {
  vi.mocked(searchPlaces).mockResolvedValue([ISTANBUL]);
  const box = screen.getByRole('combobox', { name: 'Search for a place' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(await screen.findByRole('option', { name: /Istanbul/ }));
}

const INPUT: SimulationInput = { latitude: 35.6762, longitude: 139.6503, magnitude: 7, depth_km: 15 };
function response(input = INPUT): Simulation {
  return {
    input,
    epicentral_mmi: 8.1,
    rings: [{ mmi: 6, radius_km: 100 }, { mmi: 8, radius_km: 25 }],
    exposure: [{ mmi: 6, population: 150000 }, { mmi: 8, population: 50000 }],
    cities: [{ name: 'Test city', country: 'JP', population: 200000, distance_km: 12, mmi: 7.5 }],
    fatalities: {
      bins: [{ key: '0', label: '0 deaths', probability: 0.2 }, { key: '1-10', label: '1–10 deaths', probability: 0.8 }],
      exceedance: { '1': 0.8 }, median_bin: '1-10', median_label: '1–10 deaths', alert: 'yellow',
    },
    analogs: { radius_km: 300, magnitude_window: 0.5, count: 0, deadly: 0, max_deaths: null, events: [] },
    recurrence: { radius_km: 300, magnitude: 7, start_year: 1900, end_year: 2025, reference_magnitude: 5, reference_count: 20, count_at_or_above: 3, rate_per_year: null, return_period_years: null, probability_50yr: null, method: 'insufficient-data' },
    model: { trained_at: '2026-11-09', n_train: 457, n_deadly: 457, years: [2000, 2026], min_magnitude: 5, features: ['magnitude'], metrics: { holdout_events: 116, holdout_start_year: 2019, log1p_mae: 1.19672 }, baseline: { log1p_mae: 1.14641 }, notes: ['Historical deaths only.'] },
  };
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('SimulatorView', () => {
  it('only submits on Run and uses search, slider, and map edits in the request', async () => {
    vi.mocked(simulate).mockImplementation(async (input) => response(input));
    render(<SimulatorView />);
    expect(simulate).not.toHaveBeenCalled();
    await searchAndPick();
    fireEvent.change(screen.getByLabelText('Magnitude'), { target: { value: '7.9' } });
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place epicenter' }));
    expect(simulate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await screen.findByRole('heading', { name: 'Scenario results' });
    expect(simulate).toHaveBeenCalledWith({ latitude: -12.5, longitude: -179.9, magnitude: 7.9, depth_km: 70 }, expect.any(AbortSignal));
    expect(screen.getByText('Test city')).toBeTruthy();
    expect(screen.getByText(/Conditional on historical earthquakes/)).toBeTruthy();
    expect(screen.getByText('Experimental model: held-out error did not improve on a simple historical median.')).toBeTruthy();
    fireEvent.click(screen.getByText('Model & training details'));
    expect(screen.getByText('1.19672')).toBeTruthy();
    expect(screen.getByText('1.14641')).toBeTruthy();
  });

  it('rejects blank and out-of-range coordinates instead of treating blanks as zero', () => {
    render(<SimulatorView />);
    const run = screen.getByRole<HTMLButtonElement>('button', { name: 'Run simulation' });
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '' } });
    expect(run.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '181' } });
    expect(run.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-180' } });
    expect(run.disabled).toBe(false);
  });

  it('clears results and rings immediately when the scenario changes', async () => {
    vi.mocked(simulate).mockResolvedValue(response());
    render(<SimulatorView />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await screen.findByRole('heading', { name: 'Scenario results' });
    expect(screen.getByText('Shaking rings visible')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '30' } });
    expect(screen.queryByRole('heading', { name: 'Scenario results' })).toBeNull();
    expect(screen.queryByText('Shaking rings visible')).toBeNull();
    expect(screen.getByRole('status', { name: 'Scenario status' }).textContent).toContain('Previous results cleared');
  });

  it('aborts pending requests and ignores late responses from an older scenario', async () => {
    let finishOld!: (value: Simulation) => void;
    let oldSignal: AbortSignal | undefined;
    vi.mocked(simulate).mockImplementationOnce((_input, signal) => {
      oldSignal = signal;
      return new Promise((resolve) => { finishOld = resolve; });
    }).mockImplementationOnce(async (input) => response(input));
    render(<SimulatorView />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Running simulation…' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Depth'), { target: { value: '12' } });
    expect(oldSignal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await screen.findByText(/M7.0 · 12 km deep/);
    await act(async () => { finishOld(response()); });
    expect(screen.queryByText(/M7.0 · 15 km deep/)).toBeNull();
    expect(screen.getByText(/M7.0 · 12 km deep/)).toBeTruthy();
  });

  it('shows a failed request and permits retry without old results', async () => {
    vi.mocked(simulate).mockRejectedValueOnce(new Error('Simulator data is not ready. Run uv run quakes prepare-simulator.'))
      .mockResolvedValueOnce(response());
    render(<SimulatorView />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('prepare-simulator'));
    expect(screen.queryByRole('heading', { name: 'Scenario results' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await screen.findByRole('heading', { name: 'Scenario results' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('search sets the epicenter coordinates and runs with them', async () => {
    vi.mocked(simulate).mockImplementation(async (input) => response(input));
    render(<SimulatorView />);
    await searchAndPick();
    expect(searchPlaces).toHaveBeenCalledWith('Istan', expect.any(AbortSignal));
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('41.0082');
    expect((screen.getByRole('combobox', { name: 'Search for a place' }) as HTMLInputElement).value).toBe('Istanbul, Türkiye');
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    await screen.findByRole('heading', { name: 'Scenario results' });
    expect(simulate).toHaveBeenCalledWith({ latitude: 41.0082, longitude: 28.9784, magnitude: 7, depth_km: 15 }, expect.any(AbortSignal));
  });

  it('search supports keyboard selection and never submits the form on Enter', async () => {
    vi.mocked(searchPlaces).mockResolvedValue([ISTANBUL, { ...ISTANBUL, name: 'Istanbul Airport', label: 'Istanbul Airport, Türkiye', latitude: 41.26 }]);
    render(<SimulatorView />);
    const box = screen.getByRole('combobox', { name: 'Search for a place' });
    fireEvent.change(box, { target: { value: 'Istan' } });
    await screen.findAllByRole('option');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('41.26');
    expect(simulate).not.toHaveBeenCalled();
  });

  it('does not search for fewer than two characters', async () => {
    render(<SimulatorView />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search for a place' }), { target: { value: 'I' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it('offers M4.0–9.5 and flags extrapolated magnitudes', () => {
    render(<SimulatorView />);
    const slider = screen.getByLabelText<HTMLInputElement>('Magnitude');
    expect([slider.min, slider.max]).toEqual(['4', '9.5']);
    expect(screen.getByText(/Best supported: M5.0–7.9/)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '9.1' } });
    expect(screen.getByText(/Outside M5.0–7.9/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Run simulation' }).disabled).toBe(false);
  });

  it('shows server domain warnings with the results', async () => {
    vi.mocked(simulate).mockResolvedValue({ ...response(), warnings: ['M9.1 is above the M5.0-7.9 range of the shaking equation.'] });
    render(<SimulatorView />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText(/M9.1 is above the M5.0-7.9 range/)).toBeTruthy();
  });
});
