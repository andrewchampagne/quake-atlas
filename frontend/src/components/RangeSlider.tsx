import { useId } from 'react';

interface RangeSliderProps {
  label: string;
  value: [number, number];
  min: number;
  max: number;
  step: number;
  onChange: (value: [number, number]) => void;
  /** Optional non-linear mapping: value ↔ slider position in [0, 1]. */
  toPos?: (value: number) => number;
  toValue?: (pos: number) => number;
  format?: (value: number) => string;
}

const RESOLUTION = 1000;

/** Two native range inputs on a shared track (keyboard- and screen-reader-accessible). */
export function RangeSlider({ label, value, min, max, step, onChange, toPos, toValue, format }: RangeSliderProps) {
  const id = useId();
  const nonLinear = Boolean(toPos && toValue);
  const pos = (v: number) => (nonLinear ? toPos!(v) : (v - min) / (max - min || 1));
  const [lo, hi] = value;
  const loPct = pos(lo) * 100;
  const hiPct = pos(hi) * 100;
  const fmt = format ?? String;

  const inputValue = (v: number) => (nonLinear ? Math.round(pos(v) * RESOLUTION) : v);
  const fromInput = (raw: string) => {
    const n = Number(raw);
    return nonLinear ? toValue!(n / RESOLUTION) : n;
  };

  return (
    <div className="range" role="group" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      <div className="range__track" />
      <div className="range__fill" style={{ left: `${loPct}%`, width: `${Math.max(0, hiPct - loPct)}%` }} />
      <input
        type="range"
        aria-label={`${label} minimum`}
        aria-valuetext={fmt(lo)}
        min={nonLinear ? 0 : min}
        max={nonLinear ? RESOLUTION : max}
        step={nonLinear ? 1 : step}
        value={inputValue(lo)}
        onChange={(e) => onChange([Math.min(fromInput(e.target.value), hi), hi])}
        style={{ zIndex: loPct > 90 ? 4 : 3 }}
      />
      <input
        type="range"
        aria-label={`${label} maximum`}
        aria-valuetext={fmt(hi)}
        min={nonLinear ? 0 : min}
        max={nonLinear ? RESOLUTION : max}
        step={nonLinear ? 1 : step}
        value={inputValue(hi)}
        onChange={(e) => onChange([lo, Math.max(fromInput(e.target.value), lo)])}
        style={{ zIndex: 3 }}
      />
    </div>
  );
}
