/**
 * Calendar math on epoch milliseconds that works for BCE dates.
 *
 * JS `Date` can technically represent BCE instants, but its year parsing and
 * formatting are awkward around year 0. These helpers mirror the backend's
 * `quakes.timeutil` (Howard Hinnant's algorithms, proleptic Gregorian calendar,
 * astronomical years: 1 BCE = year 0, 2 BCE = year -1).
 */

export const MS_PER_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days since 1970-01-01 for an astronomical year, month (1-12) and day. */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** Inverse of {@link daysFromCivil}: `[year, month, day]`. */
export function civilFromDays(days: number): [number, number, number] {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return [y, m, d];
}

/** Epoch ms at 00:00 UTC on January 1st of `year`. */
export function yearStartMs(year: number): number {
  return daysFromCivil(year, 1, 1) * MS_PER_DAY;
}

/** Astronomical year containing the instant `ms`. */
export function yearOf(ms: number): number {
  return civilFromDays(Math.floor(ms / MS_PER_DAY))[0];
}

/** Fractional year, e.g. 2011-07-02 ≈ 2011.5. Exact at year boundaries. */
export function msToDecimalYear(ms: number): number {
  const year = yearOf(ms);
  const start = yearStartMs(year);
  return year + (ms - start) / (yearStartMs(year + 1) - start);
}

/** Inverse of {@link msToDecimalYear}. */
export function decimalYearToMs(decimalYear: number): number {
  const year = Math.floor(decimalYear);
  const start = yearStartMs(year);
  return start + (decimalYear - year) * (yearStartMs(year + 1) - start);
}

/** `2011`, `1 BCE` (year 0), `464 BCE` (year -463). */
export function formatYear(year: number): string {
  return year <= 0 ? `${1 - year} BCE` : String(year);
}

/** `11 Mar 2011, 05:46 UTC`, or `1 Jan 464 BCE` without the time. */
export function formatDate(ms: number, withTime = true): string {
  const days = Math.floor(ms / MS_PER_DAY);
  const [y, m, d] = civilFromDays(days);
  const date = `${d} ${MONTHS[m - 1]} ${formatYear(y)}`;
  if (!withTime) return date;
  const msOfDay = ms - days * MS_PER_DAY;
  const hh = Math.floor(msOfDay / 3_600_000);
  const mm = Math.floor((msOfDay % 3_600_000) / 60_000);
  return `${date}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} UTC`;
}

/** `Mar 2011` for a fractional year. */
export function formatMonthYear(decimalYear: number): string {
  const [y, m] = civilFromDays(Math.floor(decimalYearToMs(decimalYear) / MS_PER_DAY));
  return `${MONTHS[m - 1]} ${formatYear(y)}`;
}

/**
 * Label for a half-open period of fractional years `[start, end)`.
 * Whole single years read `2011`; whole multi-year spans `2005 – 2010`;
 * anything else is shown to the month.
 */
export function formatPeriod(start: number, end: number): string {
  const whole = Number.isInteger(start) && Number.isInteger(end);
  if (whole && end - start === 1) return formatYear(start);
  if (whole || end - start >= 10) {
    return `${formatYear(Math.floor(start))} – ${formatYear(Math.ceil(end) - 1)}`;
  }
  return `${formatMonthYear(start)} – ${formatMonthYear(end)}`;
}
