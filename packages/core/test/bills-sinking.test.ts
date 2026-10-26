import { describe, expect, it } from 'vitest';
import { monthsBetween, setAsideOn, sinkingPlan, sinkingProgress } from '../src/index';

describe('the monthly figure', () => {
  const car = { repeatMonth: 11, dayOfMonth: 12, currency: 'IDR' };
  it('divides the amount by the months left, this one included', () => {
    // March to November: 8 months.
    expect(sinkingPlan({ ...car, targetMinor: 3_750_000, today: '2026-03-10' })).toEqual({ dueMonth: '2026-11', monthsLeft: 8, monthlyMinor: 468_750 });
  });
  it('rounds up to a whole unit, so the target is always reached', () => {
    expect(sinkingPlan({ ...car, targetMinor: 1_000_000, today: '2026-03-10' }).monthlyMinor).toBe(125_000);
    const odd = sinkingPlan({ ...car, targetMinor: 1_000_001, today: '2026-03-10' });
    expect(odd.monthlyMinor).toBe(125_001);
    expect(odd.monthlyMinor * odd.monthsLeft).toBeGreaterThanOrEqual(1_000_001);
    // A currency with cents rounds up to a whole major unit: 100.00 / 8 = 12.50 -> 13.00
    expect(sinkingPlan({ repeatMonth: 11, dayOfMonth: 12, currency: 'USD', targetMinor: 10_000, today: '2026-03-10' }).monthlyMinor).toBe(1_300);
  });
  it('a date already past this month means next year', () => {
    expect(sinkingPlan({ ...car, targetMinor: 1_200_000, today: '2026-11-20' })).toMatchObject({ dueMonth: '2027-11', monthsLeft: 12, monthlyMinor: 100_000 });
    // Still ahead this month: due this month, one month left.
    expect(sinkingPlan({ ...car, targetMinor: 1_200_000, today: '2026-11-05' })).toMatchObject({ dueMonth: '2026-11', monthsLeft: 1, monthlyMinor: 1_200_000 });
  });
  it('one month left sets the whole amount aside', () => {
    expect(sinkingPlan({ ...car, targetMinor: 900_000, today: '2026-10-26' })).toMatchObject({ monthsLeft: 1, monthlyMinor: 900_000 });
  });
});

describe('what is set aside over time', () => {
  const fund = { monthlyMinor: 468_750, startedMonth: '2026-03', extraMinor: 0 };
  const target = 3_750_000;
  it('counts the month it starts in, then one more each month', () => {
    expect(sinkingProgress(fund, target, '2026-11', '2026-03-10')).toEqual({ savedMinor: 468_750, monthsDone: 1, monthsTotal: 8 });
    expect(sinkingProgress(fund, target, '2026-11', '2026-05-31').savedMinor).toBe(3 * 468_750);
  });
  it('never goes above the target', () => {
    expect(sinkingProgress(fund, target, '2026-11', '2026-11-01')).toMatchObject({ savedMinor: 3_750_000, monthsDone: 8 });
    expect(sinkingProgress(fund, target, '2026-11', '2027-06-01')).toMatchObject({ savedMinor: 3_750_000, monthsDone: 8 });
  });
  it('nothing before the month it starts', () => {
    expect(sinkingProgress(fund, target, '2026-11', '2026-02-28').savedMinor).toBe(0);
  });
  it('extra money adds to it, still capped', () => {
    expect(sinkingProgress({ ...fund, extraMinor: 1_000_000 }, target, '2026-11', '2026-04-01').savedMinor).toBe(2 * 468_750 + 1_000_000);
    expect(sinkingProgress({ ...fund, extraMinor: 9_000_000 }, target, '2026-11', '2026-04-01').savedMinor).toBe(target);
  });
  it('months between', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2027-02', '2026-11')).toBe(-3);
  });
});

describe('funds in an account', () => {
  it('two funds in one account reduce what is free, together', () => {
    const view = setAsideOn(10_000_000, [], [], [
      { billId: 'a', name: 'Car insurance', promisedMinor: 1_406_250 },
      { billId: 'b', name: 'Property tax', promisedMinor: 250_000 },
    ]);
    expect(view).toMatchObject({ setAsideMinor: 1_656_250, freeMinor: 8_343_750, shortMinor: 0, state: 'covered' });
    expect(view.funds.map((fund) => fund.coveredMinor)).toEqual([1_406_250, 250_000]);
  });
  it('a shortage lands on the funds before any goal', () => {
    const goal = { goalId: 'g', name: 'Umrah', rank: 0, promisedMinor: 800_000 };
    const view = setAsideOn(1_000_000, [goal], [], [{ billId: 'a', name: 'Car', promisedMinor: 500_000 }]);
    expect(view.shortMinor).toBe(300_000);
    expect(view.funds[0]).toMatchObject({ shortMinor: 300_000, coveredMinor: 200_000 });
    expect(view.goals[0]).toMatchObject({ shortMinor: 0, coveredMinor: 800_000 });
  });
  it('is unchanged without funds', () => {
    expect(setAsideOn(100, [], [])).toMatchObject({ state: 'none', funds: [] });
  });
});
