import { useState } from 'react';
import type { FamilyStats } from '../api/types';
import { formatLogEta } from '../lib/family';
import { formatCount } from '../lib/format';

// Sequential blue ramp, dark surface: low counts sit nearest the surface.
const RAMP = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
const AXIS = '#77777d';
const GRID = '#2c2c30';
const W = 300;
const H = 230;
const M = { top: 8, right: 8, bottom: 30, left: 34 };

interface Hovered {
  i: number;
  j: number;
}

/**
 * The classic Zaliapin plot: every event's nearest neighbour by rescaled time
 * (x) and rescaled distance (y). Clustered pairs form the lower-left cloud,
 * background pairs the upper-right one; the dashed line is the threshold.
 */
export function ProximityPlot({ stats }: { stats: FamilyStats }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const { x_edges: xe, y_edges: ye, counts } = stats.density;
  const x0 = xe[0];
  const x1 = xe.at(-1)!;
  const y0 = ye[0];
  const y1 = ye.at(-1)!;
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const sx = (v: number) => M.left + ((v - x0) / (x1 - x0)) * pw;
  const sy = (v: number) => M.top + ph - ((v - y0) / (y1 - y0)) * ph;
  const max = Math.max(1, ...counts.flat());
  // Square-root scale: keeps sparse cells visible without flattening the two modes.
  const color = (c: number) => RAMP[Math.min(RAMP.length - 1, Math.floor(Math.sqrt(c / max) * RAMP.length))];

  // log T + log R = threshold, clipped to the plot box.
  const th = stats.threshold;
  const lx0 = Math.max(x0, th - y1);
  const lx1 = Math.min(x1, th - y0);
  const xTicks = range(Math.ceil(x0), Math.floor(x1), x1 - x0 > 8 ? 2 : 1);
  const yTicks = range(Math.ceil(y0), Math.floor(y1), y1 - y0 > 8 ? 2 : 1);
  const cell = hovered && {
    count: counts[hovered.i][hovered.j],
    x: [xe[hovered.i], xe[hovered.i + 1]],
    y: [ye[hovered.j], ye[hovered.j + 1]],
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Nearest-neighbour density: ${formatCount(stats.analysed)} events split by a threshold of log10 eta ${th.toFixed(2)}`}
        onMouseLeave={() => setHovered(null)}
      >
        {xTicks.map((t) => (
          <line key={`gx${t}`} x1={sx(t)} x2={sx(t)} y1={M.top} y2={M.top + ph} stroke={GRID} />
        ))}
        {yTicks.map((t) => (
          <line key={`gy${t}`} x1={M.left} x2={M.left + pw} y1={sy(t)} y2={sy(t)} stroke={GRID} />
        ))}
        {counts.map((col, i) =>
          col.map((c, j) =>
            c > 0 ? (
              <rect
                key={`${i}-${j}`}
                x={sx(xe[i])}
                y={sy(ye[j + 1])}
                width={sx(xe[i + 1]) - sx(xe[i]) + 0.3}
                height={sy(ye[j]) - sy(ye[j + 1]) + 0.3}
                fill={color(c)}
                stroke={hovered?.i === i && hovered.j === j ? '#ffffff' : 'none'}
                onMouseEnter={() => setHovered({ i, j })}
              />
            ) : null,
          ),
        )}
        {lx1 > lx0 && (
          <line x1={sx(lx0)} y1={sy(th - lx0)} x2={sx(lx1)} y2={sy(th - lx1)} stroke="#ecebe7" strokeWidth={1.5} strokeDasharray="5 4" />
        )}
        <text x={M.left + 4} y={M.top + ph - 6} fill="#aeada7" fontSize={10}>
          Clustered
        </text>
        <text x={M.left + pw - 4} y={M.top + 12} fill="#aeada7" fontSize={10} textAnchor="end">
          Background
        </text>
        {xTicks.map((t) => (
          <text key={`tx${t}`} x={sx(t)} y={M.top + ph + 12} fill={AXIS} fontSize={9} textAnchor="middle">
            {formatLogEta(t).replace('.00', '')}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={`ty${t}`} x={M.left - 4} y={sy(t) + 3} fill={AXIS} fontSize={9} textAnchor="end">
            {formatLogEta(t).replace('.00', '')}
          </text>
        ))}
        <text x={M.left + pw / 2} y={H - 4} fill={AXIS} fontSize={9} textAnchor="middle">
          log₁₀ rescaled time T
        </text>
        <text x={10} y={M.top + ph / 2} fill={AXIS} fontSize={9} textAnchor="middle" transform={`rotate(-90 10 ${M.top + ph / 2})`}>
          log₁₀ rescaled distance R
        </text>
      </svg>
      <figcaption className="tnum min-h-[2.5em] text-[10px] leading-snug text-ink-3">
        {cell ? (
          <>
            <span className="text-ink">{formatCount(cell.count)} events</span> with log₁₀ T {formatLogEta(cell.x[0])} to{' '}
            {formatLogEta(cell.x[1])} and log₁₀ R {formatLogEta(cell.y[0])} to {formatLogEta(cell.y[1])}
            {' '}({(cell.x[0] + cell.x[1]) / 2 + (cell.y[0] + cell.y[1]) / 2 < th ? 'clustered side' : 'background side'}).
          </>
        ) : (
          <>Brighter cells hold more events. Dashed line: log₁₀ T + log₁₀ R = {formatLogEta(th)}.</>
        )}
      </figcaption>
    </figure>
  );
}

function range(start: number, stop: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(start / step) * step;
  for (let v = first; v <= stop; v += step) out.push(v);
  return out;
}
