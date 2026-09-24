import { lastNMonths } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { RANGES, rangeChange, SPAN_MONTHS, spanSlice, type SpanPoint } from './span';

const point = (month: string, netWorthMinor: number | null): SpanPoint => ({ month, netWorthMinor, assetsMinor: netWorthMinor, liabilitiesMinor: 0 });

/** A series of `count` months ending September 2026, worth a million more each month. */
const series = (count: number): SpanPoint[] => lastNMonths('2026-09', count).map((month, index) => point(month, 1_000_000 + index * 1_000_000));

const monthsOf = (points: SpanPoint[]) => points.map((each) => each.month);

describe('spanSlice', () => {
  it('reads the last six months for the shortest range', () => {
    expect(monthsOf(spanSlice(series(60), '6m'))).toEqual(lastNMonths('2026-09', 6));
  });

  it('reads the last year, three years or five for the ranges that are a count', () => {
    const points = series(60);
    expect(monthsOf(spanSlice(points, '1y'))).toEqual(lastNMonths('2026-09', 12));
    expect(spanSlice(points, '3y')).toHaveLength(36);
    expect(spanSlice(points, '3y')[0]!.month).toBe('2023-10');
    expect(spanSlice(points, '5y')).toHaveLength(60);
  });

  it('reads year to date from January, not twelve months back', () => {
    const shown = spanSlice(series(36), 'ytd');
    expect(monthsOf(shown)).toEqual(lastNMonths('2026-09', 9));
    expect(shown[0]!.month).toBe('2026-01');
  });

  it('starts all where the sheet had something, not the empty months before it', () => {
    const points = series(12);
    for (const month of points.slice(0, 5)) {
      month.netWorthMinor = 0;
      month.assetsMinor = 0;
    }
    expect(monthsOf(spanSlice(points, 'all'))).toEqual(lastNMonths('2026-09', 7));
  });

  it('keeps every month of all when the first of them already held something', () => {
    expect(spanSlice(series(12), 'all')).toHaveLength(12);
  });

  it('keeps every month it was given when nothing ever held anything', () => {
    const empty = lastNMonths('2026-09', 12).map((month) => point(month, 0));
    expect(spanSlice(empty, 'all')).toHaveLength(12);
  });

  it('draws nothing from no snapshots, whatever the range', () => {
    for (const range of ['6m', 'ytd', '1y', '3y', '5y', 'all'] as const) expect(spanSlice([], range)).toEqual([]);
  });
});

describe('rangeChange', () => {
  it('reads the change between the ends of the range', () => {
    expect(rangeChange(series(6))).toEqual({ fromMinor: 1_000_000, toMinor: 6_000_000 });
  });

  it('has no change when a month at either end could not be added up', () => {
    const points = series(6);
    points[0]!.netWorthMinor = null;
    expect(rangeChange(points)).toBeNull();
    const later = series(6);
    later[5]!.netWorthMinor = null;
    expect(rangeChange(later)).toBeNull();
  });

  it('has no change from nothing at all', () => {
    expect(rangeChange([])).toBeNull();
    expect(rangeChange([point('2026-09', 5_000_000)])).toEqual({ fromMinor: 5_000_000, toMinor: 5_000_000 });
  });
});

describe('the range control', () => {
  it('offers six ranges, shortest first, as asked for', () => {
    expect(RANGES.map((range) => range.key)).toEqual(['6m', 'ytd', '1y', '3y', '5y', 'all']);
    expect(RANGES.map((range) => range.label)).toEqual(['6M', 'YTD', '1Y', '3Y', '5Y', 'ALL']);
  });

  it('knows how many months of snapshots each one is read from', () => {
    for (const range of RANGES) expect(SPAN_MONTHS[range.key]).toBeGreaterThan(0);
  });
});
