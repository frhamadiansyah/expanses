import { describe, expect, it } from 'vitest';
import { parsePeriod, periodLabel, stepPeriod, weekOf, weeksOfMonth } from '../src/index';

describe('parsePeriod', () => {
  it('reads a month', () => {
    expect(parsePeriod('2026-09')).toEqual({ kind: 'month', value: '2026-09', from: '2026-09-01', to: '2026-09-30' });
  });

  it('reads an ISO week, Monday to Sunday', () => {
    expect(parsePeriod('2026-W38')).toEqual({ kind: 'week', value: '2026-W38', from: '2026-09-14', to: '2026-09-20' });
  });

  it('reads the first ISO week of a year that starts in the year before', () => {
    // 1 January 2026 is a Thursday, so week 1 starts on Monday 29 December 2025.
    expect(parsePeriod('2026-W01')).toMatchObject({ from: '2025-12-29', to: '2026-01-04' });
  });

  it('reads a quarter and a year', () => {
    expect(parsePeriod('2026-Q3')).toEqual({ kind: 'quarter', value: '2026-Q3', from: '2026-07-01', to: '2026-09-30' });
    expect(parsePeriod('2026')).toEqual({ kind: 'year', value: '2026', from: '2026-01-01', to: '2026-12-31' });
  });

  it('reads all time and a custom stretch', () => {
    expect(parsePeriod('all')).toEqual({ kind: 'all', value: 'all', from: null, to: null });
    expect(parsePeriod('2026-07-01..2026-09-17')).toEqual({ kind: 'custom', value: '2026-07-01..2026-09-17', from: '2026-07-01', to: '2026-09-17' });
  });

  it('refuses what is not a period', () => {
    for (const bad of ['', '2026-13', '2026-W54', '2026-Q5', '26', '2026-09-17..2026-07-01', 'soon']) {
      expect(parsePeriod(bad)).toBeNull();
    }
  });
});

describe('stepPeriod', () => {
  it('steps by the period’s own unit', () => {
    expect(stepPeriod('2026-09', -1)).toBe('2026-08');
    expect(stepPeriod('2026-01', -1)).toBe('2025-12');
    expect(stepPeriod('2026-W38', 1)).toBe('2026-W39');
    expect(stepPeriod('2026-W01', -1)).toBe('2025-W52');
    expect(stepPeriod('2026-Q1', -1)).toBe('2025-Q4');
    expect(stepPeriod('2026', 1)).toBe('2027');
  });

  it('has nothing next to all time or a custom stretch', () => {
    expect(stepPeriod('all', 1)).toBeNull();
    expect(stepPeriod('2026-07-01..2026-09-17', 1)).toBeNull();
  });
});

describe('periodLabel', () => {
  it('names each kind the way a person would', () => {
    expect(periodLabel('2026-09')).toBe('September 2026');
    expect(periodLabel('2026-W38')).toBe('14 – 20 Sep 2026');
    expect(periodLabel('2026-W40')).toBe('28 Sep – 4 Oct 2026');
    expect(periodLabel('2026-W01')).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(periodLabel('2026-Q3')).toBe('Q3 2026');
    expect(periodLabel('2026')).toBe('2026');
    expect(periodLabel('all')).toBe('All time');
    expect(periodLabel('2026-07-01..2026-09-17')).toBe('1 Jul – 17 Sep 2026');
  });
});

describe('weeks', () => {
  it('finds the ISO week a day falls in', () => {
    expect(weekOf('2026-09-17')).toBe('2026-W38');
    expect(weekOf('2026-01-01')).toBe('2026-W01');
    expect(weekOf('2027-01-01')).toBe('2026-W53');
  });

  it('lists every week that touches a month', () => {
    expect(weeksOfMonth('2026-09').map((week) => week.value)).toEqual(['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40']);
  });
});
