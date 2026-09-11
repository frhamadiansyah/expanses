import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type CycleBonus, type EarnRule, type SpendLine } from '../src/points/earn';

const base: EarnRule = {
  id: 'base', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 2_500,
  rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
};
const bonus: CycleBonus = { id: 'bonus', key: 'monthly', name: 'Monthly', tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }], match: {}, validFrom: null, validTo: null };

let seq = 0;
const line = (amountMinor: number, day = 5): SpendLine => {
  seq += 1;
  return { transactionId: `r${seq}`, entryId: `e${seq}`, occurredOn: `2026-09-${String(day).padStart(2, '0')}`, categoryId: 'dining', description: 'Merchant', amountMinor, currency: 'IDR', originalCurrency: null };
};
const ancestors = { dining: [] };

describe('refunds', () => {
  it('a full refund in the same cycle nets zero points', () => {
    expect(computeCycleEarn([line(100_000, 3), line(-100_000, 8)], [base], ancestors).totalPoints).toBe(0);
  });

  it('a partial refund deducts the points its amount would earn', () => {
    const earn = computeCycleEarn([line(100_000, 3), line(-30_000, 8)], [base], ancestors);
    expect(earn.pointsByRule).toEqual({ base: 28 });
    expect(earn.spendByRule).toEqual({ base: 70_000 });
  });

  it('a refund alone never takes points below zero', () => {
    expect(computeCycleEarn([line(-500_000)], [base], ancestors).totalPoints).toBe(0);
  });

  it('a refund reduces bonus spend below a tier', () => {
    const earn = computeCycleEarn([line(21_000_000, 3), line(-2_000_000, 9)], [], ancestors, { bonuses: [bonus] });
    expect(earn.eligibleSpendByBonus).toEqual({ bonus: 19_000_000 });
    expect(earn.bonusById).toEqual({ bonus: 0 });
  });

  it('property: points and spend never go negative with random purchases and refunds', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -3_000_000, max: 3_000_000 }).filter((n) => n !== 0), { maxLength: 25 }), (amounts) => {
        const lines = amounts.map((amount, i) => line(amount, (i % 27) + 1));
        const earn = computeCycleEarn(lines, [base], ancestors, { bonuses: [bonus] });
        expect(earn.totalPoints).toBeGreaterThanOrEqual(0);
        expect(earn.pointsByRule.base).toBeGreaterThanOrEqual(0);
        expect(earn.spendByRule.base).toBeGreaterThanOrEqual(0);
        expect(earn.eligibleSpendByBonus.bonus).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
