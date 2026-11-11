import { describe, expect, it } from 'vitest';
import { readings, TODAY } from './plan-fixtures';
import { planModel } from './queries';
import { longMonth } from './plan-view';

// The dollar loan with no terms makes every month unknown; these tests read a plan whose months are known.
const known = () => {
  const r = readings();
  return { ...r, accounts: r.accounts.filter((a) => a.id !== 'L2') };
};

describe('planModel', () => {
  it('nothing saved: the suggestion’s method, else Avalanche', () => {
    const model = planModel(known(), null, TODAY);
    expect(model.method).toBe(model.suggestion?.method ?? 'avalanche');
    // With the loan with no terms, a rate is unknown: Snowball is suggested.
    expect(planModel(readings(), null, TODAY)).toMatchObject({ method: 'snowball', suggestion: { reason: 'ratesUnknown' } });
  });

  it('by hand follows the saved order, late debts still first', () => {
    const model = planModel(known(), { method: 'byHand', order: ['person:Dewi:IDR', 'C1', 'L1'], extraMinor: 0, extraCurrency: null }, TODAY);
    expect(model.effect.plan.order).toEqual(['L1', 'person:Dewi:IDR', 'C1']);
  });

  it('the extra never ends later; the header’s month is the plan without it', () => {
    const model = planModel(known(), { method: 'avalanche', order: [], extraMinor: 500_000, extraCurrency: 'IDR' }, TODAY);
    expect(model.extraMinor).toBe(500_000);
    expect(model.effect.plan.months!).toBeLessThanOrEqual(model.baseline.months!);
    expect(model.summary.debtFree.month).toBe(longMonth(model.baseline.debtFreeMonth!));
  });

  it('an extra typed in another currency converts at the held rate, or is left out and named with none', () => {
    const model = planModel(known(), { method: 'avalanche', order: [], extraMinor: 5_000, extraCurrency: 'USD' }, TODAY);
    expect(model).toMatchObject({ extraMinor: 812_500, extraMissing: null });
    const none = planModel({ ...known(), ratesToBase: {} }, { method: 'avalanche', order: [], extraMinor: 5_000, extraCurrency: 'USD' }, TODAY);
    expect(none).toMatchObject({ extraMinor: 0, extraMissing: 'USD' });
  });
});
