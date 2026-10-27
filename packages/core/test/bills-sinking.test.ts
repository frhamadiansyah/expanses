import { describe, expect, it } from 'vitest';
import { setAsideOn, sinkingPlan } from '../src/index';

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
