import { loanSchedule } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { account, loanRow, readings, TODAY } from './plan-fixtures';
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

describe('an existing loan added after this month’s payment day', () => {
  it('asks for December, is not late, and asks nothing in November', () => {
    // As loanPlanFacts reads it on 11 Nov: opened 10 Nov, the 5 Nov instalment untracked, the schedule from 1 Dec.
    const terms = { originalMinor: 40_000_000, firstPaymentOn: '2025-06-05', tenorMonths: 120, method: 'annuity' as const, paymentDay: 5 };
    const periods = [{ fromOn: '2025-06-05', rateBps: 750, kind: 'fixed' as const, paymentMinor: 0 }];
    const fact = { accountId: 'KPR', owedMinor: 28_400_000, trackFrom: '2026-11-10', instalments: [], scheduleFrom: '2026-12-01', schedule: loanSchedule(28_400_000, terms, periods, '2026-12-01') };
    const r = readings({
      accounts: [account({ id: 'KPR', name: 'KPR', subtype: 'loan' })],
      balances: { KPR: -28_400_000 },
      loans: [loanRow({ accountId: 'KPR', ...terms, periods: [{ id: 'k', accountId: 'KPR', ...periods[0]! }] })],
      items: {},
      loanFacts: [fact],
      cards: {},
      people: { youOwe: [], owedToYou: [], settled: [] },
    });
    const model = planModel(r, null, '2026-11-11');
    expect(model.summary.counts.late).toBe(0);
    expect(model.summary.payNext).toMatchObject({ item: { title: 'KPR · 19/120', dueOn: '2026-12-05', status: 'upcoming' }, when: 'due 5 Dec' });
    const kpr = model.debts.find((d) => d.key === 'KPR')!;
    expect(kpr.payoff).toMatchObject({ firstMonth: 1 });
    expect(kpr.payoff!.minimumsMinor[0]).toBe(0);
  });
});
