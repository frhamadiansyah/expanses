import { describe, expect, it } from 'vitest';
import { instalmentsFrom, matchPlanPurchase, planPurchaseOutcome, planPurchaseWindow, type PlanPurchaseLine, purchaseCandidates } from '../src/index';

/** Invented: a laptop of Rp 12.000.000 on 10 Nov 2026, 12 instalments first billed December 2026. */
const line = (transactionId: string, occurredOn: string, owedMinor: number, extra: Partial<PlanPurchaseLine> = {}): PlanPurchaseLine => ({
  transactionId,
  occurredOn,
  owedMinor,
  spending: true,
  instalment: null,
  balancing: false,
  convertedTo: null,
  ...extra,
});
const plan = { id: 'p1', totalMinor: 12_000_000, firstBilledMonth: '2026-12' };

describe('planPurchaseWindow', () => {
  it('runs from the first day three months before the first billed month to the last day of it', () => {
    expect(planPurchaseWindow('2026-12')).toEqual({ from: '2026-09-01', to: '2026-12-31' });
    expect(planPurchaseWindow('2027-02')).toEqual({ from: '2026-11-01', to: '2027-02-28' });
  });
});

describe('matchPlanPurchase', () => {
  it('finds the one purchase charging the plan’s total inside the window', () => {
    expect(matchPlanPurchase([line('kopi', '2026-11-12', 50_000), line('laptop', '2026-11-10', 12_000_000)], plan)).toBe('laptop');
  });

  it('finds none when no purchase charges the total', () => {
    expect(matchPlanPurchase([line('kopi', '2026-11-12', 50_000), line('tv', '2026-11-01', 11_999_000)], plan)).toBeNull();
  });

  it('finds none when two purchases charge the total', () => {
    expect(matchPlanPurchase([line('a', '2026-11-10', 12_000_000), line('b', '2026-10-02', 12_000_000)], plan)).toBeNull();
  });

  it('leaves out purchases outside the window', () => {
    expect(matchPlanPurchase([line('early', '2026-08-31', 12_000_000)], plan)).toBeNull();
    expect(matchPlanPurchase([line('late', '2027-01-01', 12_000_000)], plan)).toBeNull();
    expect(matchPlanPurchase([line('first', '2026-09-01', 12_000_000)], plan)).toBe('first');
    expect(matchPlanPurchase([line('last', '2026-12-31', 12_000_000)], plan)).toBe('last');
  });

  it('leaves out a purchase already another plan’s, and keeps the plan’s own', () => {
    expect(matchPlanPurchase([line('laptop', '2026-11-10', 12_000_000, { convertedTo: { planId: 'other' } })], plan)).toBeNull();
    expect(matchPlanPurchase([line('laptop', '2026-11-10', 12_000_000, { convertedTo: { planId: 'p1' } })], plan)).toBe('laptop');
  });

  it('matches a purchase abroad by what the card charged, not the merchant’s figure', () => {
    expect(matchPlanPurchase([line('abroad', '2026-11-10', 12_000_000, { originalCurrency: 'USD', originalAmountMinor: 75_000 })], plan)).toBe('abroad');
  });

  it('never matches a payment, an instalment row or a balancing line', () => {
    expect(
      matchPlanPurchase(
        [
          line('pay', '2026-11-10', 12_000_000, { spending: false }),
          line('row', '2026-11-10', 12_000_000, { instalment: { planId: 'p9' } }),
          line('bal', '2026-11-10', 12_000_000, { balancing: true }),
        ],
        plan,
      ),
    ).toBeNull();
  });
});

describe('purchaseCandidates', () => {
  it('keeps the card’s own charges that no other plan has', () => {
    const kept = purchaseCandidates([line('a', '2026-11-10', 100), line('b', '2026-11-10', -100), line('c', '2026-11-10', 100, { convertedTo: { planId: 'x' } })], 'p1');
    expect(kept.map((l) => l.transactionId)).toEqual(['a']);
  });
});

describe('planPurchaseOutcome', () => {
  it('links the one match', () => {
    expect(planPurchaseOutcome([line('laptop', '2026-11-10', 12_000_000)], plan, '2026-01-01')).toEqual({ kind: 'link', transactionId: 'laptop' });
  });

  it('counts each month with no purchase when the window ends before the card’s records start', () => {
    // An 18-of-24 plan first billed June 2025 on a card the app has tracked since 1 Oct 2026.
    expect(planPurchaseOutcome([], { id: 'p2', totalMinor: 24_000_000, firstBilledMonth: '2025-06' }, '2026-10-01')).toEqual({ kind: 'before-records' });
  });

  it('leaves a plan whose window is inside the records with none or several', () => {
    expect(planPurchaseOutcome([], plan, '2026-01-01')).toEqual({ kind: 'unlinked' });
    expect(planPurchaseOutcome([line('a', '2026-11-10', 12_000_000), line('b', '2026-11-11', 12_000_000)], plan, '2026-01-01')).toEqual({ kind: 'unlinked' });
    // No records at all: nothing says it is older.
    expect(planPurchaseOutcome([], plan, null)).toEqual({ kind: 'unlinked' });
  });
});

describe('instalmentsFrom', () => {
  it('keeps only what is billed on or after the card’s records start', () => {
    const bills = [{ statementOn: '2026-09-18' }, { statementOn: '2026-10-01' }, { statementOn: '2026-10-18' }];
    expect(instalmentsFrom(bills, '2026-10-01')).toEqual([{ statementOn: '2026-10-01' }, { statementOn: '2026-10-18' }]);
    expect(instalmentsFrom(bills, null)).toEqual(bills);
  });
});
