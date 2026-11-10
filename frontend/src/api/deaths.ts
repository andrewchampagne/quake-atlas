import { formatCount } from '../lib/format';
import type { DeathToll } from './types';

const ORDER_LABELS: Record<number, string> = {
  0: '0 (none recorded)',
  1: 'About 1–50 (approximate)',
  2: 'About 51–100 (approximate)',
  3: 'About 101–1,000 (approximate)',
  4: 'Over 1,000 (approximate)',
};

/** Interpret the compact Arrow death column without turning unknown values into zero. */
export function decodeDeathToll(value: number | undefined): DeathToll {
  if (value === undefined || !Number.isFinite(value)) return { deaths: null, deaths_order: null };
  if (value >= 0) return { deaths: value, deaths_order: null };
  const order = -value;
  return { deaths: null, deaths_order: Number.isInteger(order) && order <= 4 ? order : null };
}

/** Use structured fields: the backend's legacy label conflates unknown with none recorded. */
export function formatDeathToll({ deaths, deaths_order: order }: DeathToll): string {
  if (deaths != null && Number.isFinite(deaths) && deaths >= 0) {
    return deaths === 0 ? ORDER_LABELS[0] : formatCount(deaths);
  }
  return order == null ? 'Unknown' : (ORDER_LABELS[order] ?? 'Unknown');
}
