import { describe, expect, it } from 'vitest';
import { averageSoFar, emergencySuggestions, monthlyAverage, retirementSuggestions, spendRanges } from './spend-suggestions';

const m = (month: string, spendingMinor: number) => ({ month, incomeMinor: 0, spendingMinor, debtPaymentsMinor: 0 });

describe('spendRanges', () => {
  it('reads full calendar months for last month and the 3-month average', () => {
    const r = spendRanges('2026-03-15');
    expect(r.lastMonth).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(r.last3).toEqual({ from: '2025-12-01', to: '2026-02-28' });
    expect(r.ytd).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(r.last12).toEqual({ from: '2025-03-16', to: '2026-03-15' });
  });
  it('crosses a year start', () => {
    expect(spendRanges('2026-01-10').lastMonth).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('monthlyAverage', () => {
  it('divides by the months that had flow', () => {
    expect(monthlyAverage({ byMonth: [m('2026-01', 0), m('2026-02', 300), m('2026-03', 500)], totalMinor: 800 })).toBe(400);
  });
  it('is null with nothing', () => {
    expect(monthlyAverage({ byMonth: [m('2026-01', 0)], totalMinor: 0 })).toBeNull();
    expect(monthlyAverage(undefined)).toBeNull();
  });
});

describe('averageSoFar', () => {
  it('counts the month under way by the part that has passed', () => {
    // Jan and Feb whole, March half gone: 2.5 months.
    const range = { byMonth: [m('2026-01', 100), m('2026-02', 100), m('2026-03', 50)], totalMinor: 250 };
    expect(averageSoFar(range, '2026-03-16')).toBe(Math.round(250 / (2 + 16 / 31)));
  });
  it('starts at the first month with a transaction', () => {
    const range = { byMonth: [m('2026-01', 0), m('2026-02', 0), m('2026-03', 90)], totalMinor: 90 };
    expect(averageSoFar(range, '2026-03-31')).toBe(90);
  });
  it('is null with no spending', () => {
    expect(averageSoFar({ byMonth: [m('2026-01', 0)], totalMinor: 0 }, '2026-03-31')).toBeNull();
  });
});

describe('suggestions', () => {
  const data = {
    lastMonth: { byMonth: [m('2026-02', 1000)], totalMinor: 1000 },
    last3: { byMonth: [m('2025-12', 600), m('2026-01', 800), m('2026-02', 1000)], totalMinor: 2400 },
    ytd: { byMonth: [m('2026-01', 800), m('2026-02', 1000), m('2026-03', 0)], totalMinor: 1800 },
    last12: { byMonth: [m('2026-02', 1000)], totalMinor: 9000 },
  };
  it('emergency: three monthly figures', () => {
    const s = emergencySuggestions(data, '2026-03-31');
    expect(s.map((x) => [x.caption, x.minor])).toEqual([
      ['Last month', 1000],
      ['3-month average', 800],
      ['Average so far', 600],
    ]);
  });
  it('retirement: yearly figures', () => {
    const s = retirementSuggestions(data, '2026-03-31');
    expect(s.map((x) => [x.caption, x.minor])).toEqual([
      ['Last 12 months', 9000],
      ['Last month × 12', 12000],
      ['Average so far × 12', 7200],
    ]);
  });
  it('hides what has no data, and the whole bar when none', () => {
    expect(emergencySuggestions({}, '2026-03-31')).toEqual([]);
    expect(retirementSuggestions({ lastMonth: data.lastMonth }, '2026-03-31').map((x) => x.key)).toEqual(['last1x12']);
  });
});
