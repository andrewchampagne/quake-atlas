import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { fetchForecast, isAbortError } from '../api/client';
import type { AftershockForecast as Forecast } from '../api/types';
import { formatCompact, formatCount } from '../lib/format';
import { forecastRows, formatDays, modelAt, observedAt } from '../lib/forecast';

const OBSERVED = '#ecebe7';
const MODEL = '#3987e5';
const GRID = '#2c2c30';
const AXIS = '#77777d';
const FIT_OPTIONS = [1, 3, 7, 30];
const HORIZONS = [
  { days: 30, label: '30 d' },
  { days: 365, label: '1 yr' },
  { days: 1095, label: '3 yr' },
];

function ForecastTooltip({ active, label, forecast }: TooltipContentProps<number, string> & { forecast: Forecast }) {
  if (!active || typeof label !== 'number') return null;
  const model = modelAt(forecast, label);
  return (
    <div className="tnum rounded-lg border border-line bg-panel-solid px-2.5 py-1.5 text-xs shadow-xl">
      <div className="text-ink-2">{formatDays(label)} after the mainshock</div>
      <div className="text-ink">Recorded: {formatCount(observedAt(forecast, label))}</div>
      {model && (
        <div className="text-ink">
          {label <= forecast.fit_days ? 'Fitted' : 'Forecast'}: {formatCount(Math.round(model.expected))}
          {model.lower != null && model.upper != null && label > forecast.fit_days && (
            <span className="text-ink-2"> (95%: {formatCount(Math.round(model.lower))}–{formatCount(Math.round(model.upper))})</span>
          )}
        </div>
      )}
    </div>
  );
}

function verdict(f: Forecast): string | null {
  if (f.status !== 'ok' || !f.interval_after_fit) return null;
  const [lo, hi] = f.interval_after_fit;
  if (f.observed_after_fit > hi) return 'More aftershocks were recorded than forecast: the sequence decayed more slowly than its start suggested.';
  if (f.observed_after_fit < lo) return 'Fewer aftershocks were recorded than forecast: the sequence died down faster than its start suggested.';
  return 'The recorded count falls inside the forecast band.';
}

/** Retrospective Omori-Utsu forecast for the family's mainshock, with window controls. */
export function AftershockForecast({ mainshockRid }: { mainshockRid: number }) {
  const [fitDays, setFitDays] = useState(3);
  const [horizon, setHorizon] = useState(365);
  const [state, setState] = useState<{ key: string; forecast?: Forecast; error?: string } | null>(null);
  const key = `${mainshockRid}:${fitDays}:${horizon}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchForecast(mainshockRid, fitDays, horizon, controller.signal)
      .then((forecast) => setState({ key, forecast }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setState({ key, error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [mainshockRid, fitDays, horizon, key]);

  const current = state?.key === key ? state : null;
  const forecast = current?.forecast ?? (state?.forecast?.mainshock.rid === mainshockRid ? state.forecast : undefined);
  const rows = useMemo(() => (forecast ? forecastRows(forecast) : []), [forecast]);
  const loading = !current;

  const chooseFit = (days: number) => {
    setFitDays(days);
    if (horizon <= days) setHorizon(HORIZONS.find((h) => h.days > days)?.days ?? horizon);
  };

  const lastObserved = rows.findLastIndex((r) => r.observed != null);
  const lastForecast = rows.findLastIndex((r) => r.forecast != null);
  const xMin = rows.length ? rows[0].days : 0.01;
  const xMax = forecast?.horizon_days ?? horizon;
  const ticks = [0.01, 0.1, 1, 10, 100, 1000].filter((t) => t >= xMin && t <= xMax);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          Fit first
          <span className="seg" role="group" aria-label="Fitting window">
            {FIT_OPTIONS.map((d) => (
              <button key={d} type="button" aria-pressed={fitDays === d} onClick={() => chooseFit(d)}>
                {d} d
              </button>
            ))}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          Compare to
          <span className="seg" role="group" aria-label="Forecast horizon">
            {HORIZONS.map((h) => (
              <button key={h.days} type="button" aria-pressed={horizon === h.days} disabled={h.days <= fitDays} onClick={() => setHorizon(h.days)}>
                {h.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {current?.error && <div className="callout callout-danger mt-2 block">Couldn't load the forecast: {current.error}</div>}
      {!forecast && loading && <p className="mt-2 text-xs text-ink-3">Fitting…</p>}

      {forecast && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {forecast.status === 'ok' && forecast.interval_after_fit ? (
            <dl className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-line p-2.5 text-xs">
              <div>
                <dt className="text-ink-3">
                  Forecast, {formatDays(forecast.fit_days)} to {formatDays(forecast.horizon_days)}
                </dt>
                <dd className="tnum mt-1 text-xl font-semibold text-ink">
                  {formatCount(Math.round(forecast.expected_after_fit ?? 0))}
                </dd>
                <dd className="tnum text-[11px] text-ink-2">
                  95%: {formatCount(forecast.interval_after_fit[0])}–{formatCount(forecast.interval_after_fit[1])}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Recorded</dt>
                <dd className="tnum mt-1 text-xl font-semibold text-ink">{formatCount(forecast.observed_after_fit)}</dd>
                <dd className="text-[11px] text-ink-2">M {forecast.min_magnitude.toFixed(1)}+ aftershocks</dd>
              </div>
            </dl>
          ) : (
            forecast.message && <p className="mt-2 text-xs text-ink-2">{forecast.message}</p>
          )}
          {verdict(forecast) && <p className="mt-1.5 text-xs text-ink">{verdict(forecast)}</p>}

          {rows.length > 1 && (
            <>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-2" aria-hidden="true">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3" style={{ background: OBSERVED }} /> Recorded
                </span>
                {forecast.status === 'ok' && (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-0.5 w-3" style={{ background: MODEL }} /> Omori–Utsu fit, then forecast
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-3 rounded-sm" style={{ background: MODEL, opacity: 0.25 }} /> 95% band
                    </span>
                  </>
                )}
              </div>
              <div
                className="h-44"
                role="img"
                aria-label={`Cumulative aftershocks over time on a log scale: ${formatCount(forecast.observed_after_fit)} recorded after the fitting window${forecast.expected_after_fit != null ? `, ${formatCount(Math.round(forecast.expected_after_fit))} forecast` : ''}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="days"
                      type="number"
                      scale="log"
                      domain={[xMin, xMax]}
                      ticks={ticks}
                      tickFormatter={(v: number) => formatDays(v)}
                      tick={{ fill: AXIS, fontSize: 10 }}
                      axisLine={{ stroke: GRID }}
                      tickLine={false}
                      allowDataOverflow
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCompact(v)}
                      tick={{ fill: AXIS, fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={40}
                    />
                    <Tooltip
                      content={(props) => <ForecastTooltip {...(props as TooltipContentProps<number, string>)} forecast={forecast} />}
                      cursor={{ stroke: '#5b5b60' }}
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      x={forecast.fit_days}
                      stroke={AXIS}
                      strokeDasharray="3 3"
                      label={{ value: 'fit ends', position: 'insideBottomRight', fill: AXIS, fontSize: 9 }}
                    />
                    <Area dataKey="band" stroke="none" fill={MODEL} fillOpacity={0.22} connectNulls isAnimationActive={false} activeDot={false} />
                    <Line dataKey="fit" stroke={MODEL} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                    <Line
                      dataKey="forecast"
                      stroke={MODEL}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                      label={endLabel(lastForecast, 'Forecast')}
                    />
                    <Line
                      dataKey="observed"
                      type="stepAfter"
                      stroke={OBSERVED}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                      label={endLabel(lastObserved, 'Recorded')}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {forecast.params && (
            <p className="tnum mt-1 text-[10px] text-ink-3">
              {forecast.params.method === 'maximum-likelihood' ? 'Fitted' : 'Generic shape'}: p = {forecast.params.p.toFixed(2)}, c ={' '}
              {formatDays(forecast.params.c_days)}, from {formatCount(forecast.n_fit)} aftershocks.
            </p>
          )}
          {forecast.notes.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] leading-snug text-ink-3">
              {forecast.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Recharts label renderer that names a series at its last point only. */
function endLabel(lastIndex: number, text: string) {
  return function EndLabel(props: { index?: number; x?: number | string; y?: number | string }) {
    if (props.index !== lastIndex || props.x == null || props.y == null) return null;
    return (
      <text x={Number(props.x) - 4} y={Number(props.y) - 6} fill="#aeada7" fontSize={10} textAnchor="end">
        {text}
      </text>
    );
  };
}
