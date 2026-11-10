import { formatCompact, formatNumber, formatProbability, intensity } from './presentation';
import type { ModelCard, Simulation } from './types';

const METRIC_LABELS: Record<string, string> = {
  log1p_mae: 'Mean absolute error, log(1 + deaths)',
  holdout_events: 'Held-out events',
  holdout_start_year: 'Held-out period begins',
};

function MetricValues({ values }: { values: Record<string, number | null> }) {
  return Object.keys(values).length > 0 ? <dl className="sim-model-stats">
    {Object.entries(values).map(([key, value]) => <div key={key}>
      <dt>{METRIC_LABELS[key] ?? key.replaceAll('_', ' ')}</dt>
      <dd>{value == null ? 'Unavailable' : Number.isInteger(value) ? String(value) : value.toFixed(5)}</dd>
    </div>)}
  </dl> : <p>Evaluation metrics unavailable.</p>;
}

function ModelDetails({ model }: { model: ModelCard }) {
  return <details className="sim-model-details">
    <summary>Model &amp; training details</summary>
    <dl className="sim-model-stats">
      <div><dt>Training events</dt><dd>{formatNumber(model.n_train)}</dd></div>
      <div><dt>Events with fatalities</dt><dd>{formatNumber(model.n_deadly)}</dd></div>
      <div><dt>Catalog years</dt><dd>{model.years[0]}–{model.years[1]}</dd></div>
      <div><dt>Minimum magnitude</dt><dd>M{model.min_magnitude.toFixed(1)}</dd></div>
      <div><dt>Trained</dt><dd>{model.trained_at}</dd></div>
    </dl>
    <h3>Held-out evaluation</h3>
    <MetricValues values={model.metrics} />
    <h3>Historical median baseline</h3>
    <MetricValues values={model.baseline} />
    <p>Lower mean absolute error is better. Evaluation uses log(1 + reported deaths); this does not validate forecast probabilities.</p>
    {model.notes.length > 0 && <ul>{model.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {model.features.length > 0 && <p>Features: {model.features.join(', ')}.</p>}
  </details>;
}

export default function SimulationResults({ result }: { result: Simulation }) {
  const levels = result.exposure.slice().sort((a, b) => b.mmi - a.mmi);
  const totalPopulation = levels.reduce((sum, level) => sum + level.population, 0);
  const maxPopulation = Math.max(1, ...levels.map((level) => level.population));
  const epicentral = intensity(result.epicentral_mmi);
  const modelError = result.model.metrics.log1p_mae;
  const baselineError = result.model.baseline.log1p_mae;
  const didNotImprove = typeof modelError === 'number' && typeof baselineError === 'number' && modelError >= baselineError;

  return <div className="sim-results" aria-label="Simulation results">
    <section className="sim-result-section">
      <div className="sim-section-heading"><h2>Scenario results</h2><span className="tag">Hypothetical</span></div>
      <p className="sim-result-input">M{result.input.magnitude.toFixed(1)} · {result.input.depth_km} km deep · {result.input.latitude.toFixed(3)}, {result.input.longitude.toFixed(3)}</p>
      {result.warnings?.map((warning) => <p key={warning} className="callout callout-warn sim-quality-warning"><span aria-hidden="true">▲</span><span>{warning}</span></p>)}
      <div className="sim-intensity-card">
        <span className="eyebrow">Epicentral shaking</span>
        <strong style={{ color: epicentral.color }}><span>{epicentral.roman}</span> {epicentral.label}</strong>
        <p>Estimated MMI {result.epicentral_mmi.toFixed(1)} on the Modified Mercalli scale.</p>
      </div>
    </section>

    <section className="sim-result-section" aria-labelledby="sim-exposure-heading">
      <div className="sim-section-heading"><h2 id="sim-exposure-heading">Population by intensity</h2><span className="sim-total">{formatCompact(totalPopulation)}</span></div>
      <p className="sim-muted">Population in listed cities, grouped by rounded MMI. This is city coverage, not total regional exposure.</p>
      {totalPopulation > 0 ? <ul className="sim-exposure-list">
        {levels.map((level) => <li key={level.mmi}>
          <div className="sim-exposure-label"><span><b style={{ color: intensity(level.mmi).color }}>{intensity(level.mmi).roman}</b> {intensity(level.mmi).label}</span><span>{formatNumber(level.population)}</span></div>
          <div className="sim-bar" aria-hidden="true"><span style={{ width: `${level.population / maxPopulation * 100}%`, background: intensity(level.mmi).color }} /></div>
        </li>)}
      </ul> : <p className="sim-empty-note">No listed city population in the modeled shaking area. This does not mean no people are exposed.</p>}
    </section>

    <section className="sim-result-section" aria-labelledby="sim-fatalities-heading">
      <h2 id="sim-fatalities-heading">Reported fatality distribution</h2>
      <p className="callout callout-warn sim-quality-warning"><span aria-hidden="true">▲</span><span>{didNotImprove
        ? 'Experimental model: held-out error did not improve on a simple historical median.'
        : 'Experimental model: these probabilities are not validated forecasts.'}</span></p>
      <p className="sim-conditional">Conditional on historical earthquakes with known reported death counts. Selection bias applies; these are not validated forecast probabilities.</p>
      <div className="sim-fatality-median"><span>Median fatality range</span><strong>{result.fatalities.median_label}</strong></div>
      <ul className="sim-fatality-bins" aria-label="Conditional fatality probability bins">
        {result.fatalities.bins.map((bin) => <li key={bin.key} className={bin.key === result.fatalities.median_bin ? 'sim-median-bin' : ''}>
          <div className="sim-bin-label"><span>{bin.label}{bin.key === result.fatalities.median_bin && <small className="tag">median</small>}</span><span>{formatProbability(bin.probability)}</span></div>
          <div className="sim-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, bin.probability)) * 100}%` }} /></div>
        </li>)}
      </ul>
      <p className="sim-muted">Ranges refer to reported deaths in the training sample. Unrecorded impacts and differences in vulnerability limit interpretation.</p>
    </section>

    <section className="sim-result-section" aria-labelledby="sim-cities-heading">
      <div className="sim-section-heading"><h2 id="sim-cities-heading">City impacts</h2><span className="sim-total">{formatNumber(result.cities.length)}</span></div>
      {result.cities.length > 0 ? <div className="sim-table-wrap" tabIndex={0} role="region" aria-label="City impacts table, scroll to see more">
        <table className="sim-city-table">
          <caption>Estimated shaking and listed population by city</caption>
          <thead><tr><th scope="col">City</th><th scope="col">Population</th><th scope="col">Distance</th><th scope="col">MMI</th></tr></thead>
          <tbody>{result.cities.map((city, index) => <tr key={`${city.name}-${city.country}-${index}`}>
            <th scope="row">{city.name}{city.country && <small>{city.country}</small>}</th>
            <td>{formatNumber(city.population)}</td>
            <td>{city.distance_km.toFixed(0)} km</td>
            <td><span className="sim-mmi-badge" style={{ color: intensity(city.mmi).color }} title={intensity(city.mmi).label}>{city.mmi.toFixed(1)}</span></td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="sim-empty-note">No cities returned for this scenario. City coverage is incomplete.</p>}
    </section>

    <section className="sim-result-section" aria-labelledby="sim-analogs-heading">
      <h2 id="sim-analogs-heading">Historical context</h2>
      <p className="sim-muted">{formatNumber(result.analogs.count)} similar catalog events within {formatNumber(result.analogs.radius_km)} km and ±{result.analogs.magnitude_window.toFixed(1)} magnitude.</p>
      {result.analogs.events.length > 0 && <ul className="sim-analog-list">
        {result.analogs.events.slice(0, 5).map((event) => <li key={event.event_id}>
          <span className="sim-analog-magnitude">M{event.magnitude.toFixed(1)}</span>
          <div><strong>{event.place || 'Unnamed location'}</strong><span>{event.year} · {event.distance_km.toFixed(0)} km away · {event.deaths_label} reported deaths</span></div>
        </li>)}
      </ul>}
      <p className="sim-muted">The {result.recurrence.start_year}–{result.recurrence.end_year} catalog contains {formatNumber(result.recurrence.count_at_or_above)} events of M{result.input.magnitude.toFixed(1)} or greater within {formatNumber(result.recurrence.radius_km)} km. Catalog completeness varies. These counts cannot predict when an earthquake will occur.</p>
    </section>

    <section className="sim-result-section"><ModelDetails model={result.model} /></section>
  </div>;
}
