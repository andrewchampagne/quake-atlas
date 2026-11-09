import { describe, expect, it } from 'vitest';
import {
  civilFromDays,
  daysFromCivil,
  decimalYearToMs,
  formatDate,
  formatPeriod,
  formatYear,
  msToDecimalYear,
  yearOf,
  yearStartMs,
} from './time';

describe('calendar math', () => {
  it('matches Date.UTC for modern dates', () => {
    for (const [y, m, d] of [
      [1970, 1, 1],
      [1900, 1, 1],
      [2000, 2, 29],
      [2011, 3, 11],
      [2099, 12, 31],
    ]) {
      expect(daysFromCivil(y, m, d) * 86_400_000).toBe(Date.UTC(y, m - 1, d));
    }
  });

  it('agrees with the backend for BCE dates', () => {
    // Values from quakes.timeutil.days_from_civil (numpy-verified).
    expect(daysFromCivil(-463, 1, 1)).toBe(-888_635);
    expect(daysFromCivil(0, 3, 1)).toBe(-719_468);
  });

  it('round-trips days through civil dates', () => {
    for (let days = -1_500_000; days < 200_000; days += 9_973) {
      const [y, m, d] = civilFromDays(days);
      expect(daysFromCivil(y, m, d)).toBe(days);
    }
  });

  it('finds the year of BCE instants', () => {
    expect(yearOf(yearStartMs(-463))).toBe(-463);
    expect(yearOf(yearStartMs(-463) - 1)).toBe(-464);
  });

  it('converts to and from decimal years', () => {
    expect(msToDecimalYear(yearStartMs(2011))).toBe(2011);
    const mid = Date.UTC(2011, 6, 2, 12);
    expect(msToDecimalYear(mid)).toBeCloseTo(2011.5, 2);
    expect(decimalYearToMs(msToDecimalYear(mid))).toBeCloseTo(mid, -1);
    expect(msToDecimalYear(yearStartMs(-1000))).toBe(-1000);
  });
});

describe('formatting', () => {
  it('formats years with BCE', () => {
    expect(formatYear(2011)).toBe('2011');
    expect(formatYear(0)).toBe('1 BCE');
    expect(formatYear(-463)).toBe('464 BCE');
  });

  it('formats dates', () => {
    expect(formatDate(Date.UTC(2011, 2, 11, 5, 46, 24))).toBe('11 Mar 2011, 05:46 UTC');
    expect(formatDate(daysFromCivil(-463, 7, 4) * 86_400_000, false)).toBe('4 Jul 464 BCE');
  });

  it('formats periods', () => {
    expect(formatPeriod(2011, 2012)).toBe('2011');
    expect(formatPeriod(2005, 2010)).toBe('2005 – 2009');
    expect(formatPeriod(2011.2, 2012.2)).toBe('Mar 2011 – Mar 2012');
    expect(formatPeriod(-500, -400)).toBe('501 BCE – 402 BCE');
  });
});
