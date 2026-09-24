import { describe, expect, it } from 'vitest';
import { balanceSeries, crossing, dayBefore } from './balance-series';

/*
 * The tile's line: a balance walked backwards through what moved, and the day it went below nothing. The arithmetic
 * is the whole of it — the drawing is a polyline — so this is where the tile's promise lives: the line ends on the
 * figure above it, and the crossing carries a date.
 */
describe('the tile’s balance line', () => {
  it('ends on today’s figure and steps back through what moved', () => {
    const series = balanceSeries({
      todayMinor: 90,
      today: '2026-09-24',
      days: 3,
      flows: [
        { on: '2026-09-24', minor: 10 }, // money arrived today: yesterday held 80
        { on: '2026-09-22', minor: -5 },
      ],
    });
    expect(series.map((day) => [day.on, day.minor])).toEqual([
      ['2026-09-21', 85], // the 22nd's −5 had not left yet
      ['2026-09-22', 80],
      ['2026-09-23', 80],
      ['2026-09-24', 90], // today, with the +10 that arrived this morning
    ]);
    expect(series.at(-1)!.minor).toBe(90);
  });

  it('keeps the balance flat on a day nothing moved', () => {
    const series = balanceSeries({ todayMinor: 5, today: '2026-09-24', days: 4, flows: [{ on: '2026-09-24', minor: 5 }] });
    expect(series.map((day) => day.minor)).toEqual([0, 0, 0, 0, 5]);
  });

  it('walks a month back one day at a time, across a month boundary', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2026-01-01')).toBe('2025-12-31');
    const series = balanceSeries({ todayMinor: 0, today: '2026-03-01', days: 2, flows: [] });
    expect(series.map((day) => day.on)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('carries the date of the first day below nothing, and where between the two days it crossed', () => {
    const series = balanceSeries({
      todayMinor: -50,
      today: '2026-09-24',
      days: 3,
      // 100 a day leaving: the line reads 100, 50, 0, −50 — it touched nothing on the 23rd and went under on the 24th.
      flows: [
        { on: '2026-09-22', minor: -50 },
        { on: '2026-09-23', minor: -50 },
        { on: '2026-09-24', minor: -50 },
      ],
    });
    const crossed = crossing(series);
    expect(series.map((day) => day.minor)).toEqual([100, 50, 0, -50]);
    expect(crossed?.on).toBe('2026-09-24');
    // It sat on nothing the day before, so the crossing is that day's very end.
    expect(crossed?.through).toBe(0);
  });

  it('answers nothing when the balance never goes below nothing', () => {
    const series = balanceSeries({ todayMinor: 30, today: '2026-09-24', days: 2, flows: [{ on: '2026-09-24', minor: 10 }] });
    expect(crossing(series)).toBeNull();
  });

  it('places an uneven crossing between the two readings', () => {
    // +30 then −10: the crossing is three quarters of the way through the day before.
    const series = balanceSeries({ todayMinor: -10, today: '2026-09-24', days: 1, flows: [{ on: '2026-09-24', minor: -40 }] });
    expect(series.map((day) => day.minor)).toEqual([30, -10]);
    expect(crossing(series)?.through).toBeCloseTo(30 / 40, 10);
  });
});
