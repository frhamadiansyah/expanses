import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type CycleBonus, type EarnRule, type SpendLine } from '../src/index';

const ancestors = {};
const line = (transactionId: string, amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId, entryId: `${transactionId}-1`, occurredOn: '2026-09-05', categoryId: 'dining', description: 'Merchant',
  amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, ...over,
});
const rule = (over: Partial<EarnRule> = {}): EarnRule => ({
  id: 'base', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20_000, rounding: 'per_increment',
  capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null, ...over,
});

describe('points per purchase', () => {
  it('sums rule allocations per purchase, stackable rules included', () => {
    const earn = computeCycleEarn([line('a', 60_000), line('b', 25_000)], [rule(), rule({ id: 'extra', stackable: true, rateNum: 2 })], ancestors);
    expect(earn.pointsByTransaction).toEqual({ a: 9, b: 3 });
    expect(earn.approximateTransactionIds).toEqual([]);
  });

  it('reports one total for a split purchase', () => {
    const lines = [line('split', 30_000), line('split', 30_000, { entryId: 'split-2', categoryId: 'groceries' })];
    expect(computeCycleEarn(lines, [rule({ rounding: 'per_transaction_floor' })], ancestors).pointsByTransaction).toEqual({ split: 3 });
  });

  it('shares cycle-rounded points by spend and marks those purchases approximate', () => {
    const earn = computeCycleEarn([line('a', 15_000), line('b', 15_000), line('c', 30_000)], [rule({ rounding: 'per_cycle_sum' })], ancestors);
    expect(earn.totalPoints).toBe(3);
    expect(earn.pointsByTransaction).toEqual({ a: 0.8, b: 0.7, c: 1.5 });
    expect(earn.approximateTransactionIds).toEqual(['a', 'b', 'c']);
  });

  it('gives a refund negative points', () => {
    expect(computeCycleEarn([line('buy', 60_000), line('refund', -20_000)], [rule()], ancestors).pointsByTransaction).toEqual({ buy: 3, refund: -1 });
  });

  it('keeps cycle bonuses out of purchases', () => {
    const bonus: CycleBonus = { id: 'm', key: 'm', name: 'Milestone', tiers: [{ minSpendMinor: 50_000, bonus: 100 }], match: {}, validFrom: null, validTo: null };
    const earn = computeCycleEarn([line('a', 60_000)], [rule()], ancestors, { bonuses: [bonus] });
    expect(earn.totalPoints).toBe(103);
    expect(earn.pointsByTransaction).toEqual({ a: 3 });
  });
});
