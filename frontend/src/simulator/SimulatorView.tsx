import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { simulate } from './client';
import SimulatorMap from './SimulatorMap';
import { LocationSearch } from './LocationSearch';
import { DEPTH_RANGE, MAGNITUDE_RANGE, SUPPORTED_MAGNITUDE, isExtrapolatedMagnitude } from './presentation';
import SimulationResults from './SimulationResults';
import type { Simulation, SimulationInput } from './types';
import './simulator.css';

/** Opening scenario; any place can then be searched for or clicked on the map. */
const DEFAULT_SCENARIO = { label: 'Tokyo, Japan', latitude: 35.6762, longitude: 139.6503, magnitude: 7, depth_km: 15 };

type Draft = { latitude: string; longitude: string; magnitude: number; depth_km: number };
type Status = 'idle' | 'loading' | 'success' | 'error';

export default function SimulatorView() {
  const [draft, setDraft] = useState<Draft>({
    latitude: String(DEFAULT_SCENARIO.latitude),
    longitude: String(DEFAULT_SCENARIO.longitude),
    magnitude: DEFAULT_SCENARIO.magnitude,
    depth_km: DEFAULT_SCENARIO.depth_km,
  });
  const [result, setResult] = useState<Simulation | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [editedAfterRun, setEditedAfterRun] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const hasRun = useRef(false);

  useEffect(() => () => pending.current?.abort(), []);

  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  const latitudeValid = draft.latitude.trim() !== '' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
  const longitudeValid = draft.longitude.trim() !== '' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const valid = latitudeValid && longitudeValid
    && draft.magnitude >= MAGNITUDE_RANGE[0] && draft.magnitude <= MAGNITUDE_RANGE[1]
    && draft.depth_km >= DEPTH_RANGE[0] && draft.depth_km <= DEPTH_RANGE[1];
  const extrapolated = isExtrapolatedMagnitude(draft.magnitude);
  const location = latitudeValid && longitudeValid ? { latitude, longitude } : null;

  function update(patch: Partial<Draft>) {
    pending.current?.abort();
    pending.current = null;
    setDraft((previous) => ({ ...previous, ...patch }));
    setResult(null);
    setError(null);
    setStatus('idle');
    setEditedAfterRun(hasRun.current);
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    hasRun.current = true;
    const input: SimulationInput = { latitude, longitude, magnitude: draft.magnitude, depth_km: draft.depth_km };
    setResult(null);
    setStatus('loading');
    setError(null);
    setEditedAfterRun(false);
    try {
      const next = await simulate(input, controller.signal);
      if (controller.signal.aborted || pending.current !== controller) return;
      setResult(next);
      setStatus('success');
    } catch (cause) {
      if (controller.signal.aborted || pending.current !== controller) return;
      setError(cause instanceof Error ? cause.message : 'The simulation failed. Please try again.');
      setStatus('error');
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  const statusText = status === 'loading' ? 'Running scenario…'
    : status === 'success' ? 'Simulation complete. Results match the current scenario.'
    : editedAfterRun ? 'Scenario changed. Previous results cleared. Run simulation to update.'
    : 'Choose a scenario and run the simulation.';

  return (
    <main className="simulator" aria-label="Earthquake scenario simulator">
      <aside className="sim-controls" aria-labelledby="sim-title">
        <div className="sim-heading">
          <span className="eyebrow">Scenario lab</span>
          <h1 id="sim-title">Earthquake simulator</h1>
          <p className="sim-muted">Explore hypothetical shaking and exposure. Cannot predict earthquake occurrence.</p>
        </div>
        <form onSubmit={run} noValidate>
          <LocationSearch
            initialQuery={DEFAULT_SCENARIO.label}
            onSelect={(place) => update({
              latitude: String(Number(place.latitude.toFixed(4))),
              longitude: String(Number(place.longitude.toFixed(4))),
            })}
          />

          <fieldset className="sim-coordinates">
            <legend className="eyebrow">Epicenter coordinates</legend>
            <div className="sim-coordinate-grid">
              <div>
                <label htmlFor="sim-latitude">Latitude</label>
                <input id="sim-latitude" className="field" type="number" inputMode="decimal" min={-90} max={90} step="any" required value={draft.latitude} onChange={(event) => update({ latitude: event.target.value })} aria-invalid={!latitudeValid} aria-describedby="sim-latitude-help" />
                <span id="sim-latitude-help" className={`sim-input-help${latitudeValid ? '' : ' sim-invalid'}`}>−90 to 90°</span>
              </div>
              <div>
                <label htmlFor="sim-longitude">Longitude</label>
                <input id="sim-longitude" className="field" type="number" inputMode="decimal" min={-180} max={180} step="any" required value={draft.longitude} onChange={(event) => update({ longitude: event.target.value })} aria-invalid={!longitudeValid} aria-describedby="sim-longitude-help" />
                <span id="sim-longitude-help" className={`sim-input-help${longitudeValid ? '' : ' sim-invalid'}`}>−180 to 180°</span>
              </div>
            </div>
            <p className="sim-muted">Or click anywhere on the map.</p>
          </fieldset>

          <div className="sim-slider">
            <div><label htmlFor="sim-magnitude">Magnitude</label><output htmlFor="sim-magnitude">M{draft.magnitude.toFixed(1)}</output></div>
            <input id="sim-magnitude" className="slider" type="range" min={MAGNITUDE_RANGE[0]} max={MAGNITUDE_RANGE[1]} step={0.1} value={draft.magnitude} onChange={(event) => update({ magnitude: Number(event.target.value) })} aria-describedby="sim-magnitude-note" style={progress(draft.magnitude, MAGNITUDE_RANGE)} />
            <div className="sim-slider-limits"><span>M{MAGNITUDE_RANGE[0].toFixed(1)}</span><span>M{MAGNITUDE_RANGE[1].toFixed(1)}</span></div>
            <p id="sim-magnitude-note" className={`sim-slider-note${extrapolated ? ' sim-is-extrapolated' : ''}`}>
              {extrapolated
                ? `▲ Outside M${SUPPORTED_MAGNITUDE[0].toFixed(1)}–${SUPPORTED_MAGNITUDE[1].toFixed(1)}: shaking and estimates are extrapolated and less reliable.`
                : `Best supported: M${SUPPORTED_MAGNITUDE[0].toFixed(1)}–${SUPPORTED_MAGNITUDE[1].toFixed(1)}.`}
            </p>
          </div>
          <div className="sim-slider">
            <div><label htmlFor="sim-depth">Depth</label><output htmlFor="sim-depth">{draft.depth_km} km</output></div>
            <input id="sim-depth" className="slider" type="range" min={DEPTH_RANGE[0]} max={DEPTH_RANGE[1]} step={1} value={draft.depth_km} onChange={(event) => update({ depth_km: Number(event.target.value) })} style={progress(draft.depth_km, DEPTH_RANGE)} />
            <div className="sim-slider-limits"><span>{DEPTH_RANGE[0]} km · shallow</span><span>{DEPTH_RANGE[1]} km</span></div>
          </div>

          <button className="btn btn-primary sim-run" type="submit" disabled={!valid || status === 'loading'}>{status === 'loading' ? 'Running simulation…' : 'Run simulation'}<span aria-hidden="true">→</span></button>
          <p className="sim-status" role="status" aria-label="Scenario status" aria-live="polite">{statusText}</p>
          {error && <div className="callout callout-danger sim-error" role="alert"><strong>Simulation unavailable</strong><p>{error}</p></div>}
        </form>

        <details className="sim-caveats">
          <summary>About this simulator</summary>
          <p>This is an educational scenario tool. It cannot predict earthquake occurrence.</p>
          <p>Fatality probabilities are conditional on historical events with known reported deaths. This selected sample has reporting and selection bias. Results are not validated forecasts.</p>
          <p>Shaking uses an intensity equation fitted to M{SUPPORTED_MAGNITUDE[0].toFixed(1)}–{SUPPORTED_MAGNITUDE[1].toFixed(1)} crustal earthquakes. Larger or smaller scenarios are extrapolated, and great subduction earthquakes rupture hundreds of kilometres of fault, which a circular footprint cannot represent.</p>
          <p>Idealized shaking and incomplete city populations do not capture all local hazards or vulnerability.</p>
        </details>
      </aside>

      <SimulatorMap location={location} result={result} onPlace={(lat, lon) => update({ latitude: String(lat), longitude: String(lon) })} />

      <aside className="sim-results-panel" aria-label="Scenario impact estimates" aria-busy={status === 'loading'}>
        {result ? <SimulationResults result={result} /> : <div className="sim-results-empty">
          <span className={`sim-empty-symbol${status === 'loading' ? ' sim-is-loading' : ''}`} aria-hidden="true">◎</span>
          <span className="eyebrow">Impact estimates</span>
          <h2>{status === 'loading' ? 'Calculating this scenario' : error ? 'Unable to calculate' : editedAfterRun ? 'Ready for a fresh scenario' : 'What if it happened here?'}</h2>
          <p>{status === 'loading' ? 'Estimating shaking, listed city exposure, and the conditional reported fatality distribution.' : error ? 'Review the error beside the controls, then run the simulation again.' : editedAfterRun ? 'Your inputs changed. Run the simulation to see results for the new scenario.' : 'Run a simulation to explore shaking intensity, nearby cities, and population exposure.'}</p>
          <div className="sim-empty-features"><span>Shaking intensity</span><span>City population exposure</span><span>Conditional fatality ranges</span><span>Historical context</span></div>
        </div>}
      </aside>
    </main>
  );
}

/** Filled-track percentage for the shared `.slider` style. */
function progress(value: number, [min, max]: readonly [number, number]): CSSProperties {
  return { '--progress': `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
}
