import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type CycleBonus, type EarnRule, nextBonusTier, type SpendLine } from '../src/points/earn';

const ancestors = { dining: ['food'], food: [], electricity: ['utilities'], utilities: [] };
const exclusions = { excludeCategoryIds: ['electricity'] };

const base: EarnRule = {
  id: 'base', name: 'Base', priority: 0, stackable: false, match: exclusions, rateNum: 1, rateDen: 13_500,
  rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
};

const signature: CycleBonus = {
  id: 'sig', key: 'monthly-spend', name: 'Monthly spend bonus', tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }],
  match: exclusions, validFrom: null, validTo: null,
};
const infinite: CycleBonus = {
  id: 'inf', key: 'monthly-spend', name: 'Monthly spend bonus',
  tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }, { minSpendMinor: 50_000_000, bonus: 2000 }],
  match: exclusions, validFrom: null, validTo: null,
};

let seq = 0;
const buy = (amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => {
  seq += 1;
  return { transactionId: `t${seq}`, entryId: `e${seq}`, occurredOn: '2026-09-05', categoryId: 'dining', description: 'Merchant', amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, ...over };
};

describe('tiered cycle bonuses', () => {
  it('Signature pays 0 at Rp 19.999.999 and 1.000 at Rp 20.000.000', () => {
    const below = computeCycleEarn([buy(19_999_999)], [base], ancestors, { bonuses: [signature] });
    expect(below.bonusById).toEqual({ sig: 0 });
    expect(below.totalPoints).toBe(1481);
    const at = computeCycleEarn([buy(20_000_000)], [base], ancestors, { bonuses: [signature] });
    expect(at.bonusById).toEqual({ sig: 1000 });
    expect(at.pointsByRule).toEqual({ base: 1481 });
    expect(at.totalPoints).toBe(2481);
  });

  it('Infinite pays only the highest tier reached', () => {
    const at = (amount: number) => computeCycleEarn([buy(amount)], [], ancestors, { bonuses: [infinite] }).bonusById.inf;
    expect(at(19_900_000)).toBe(0);
    expect(at(20_000_000)).toBe(1000);
    expect(at(50_000_000)).toBe(2000);
    expect(at(60_000_000)).toBe(2000);
  });

  it('accumulates eligible spend across purchases and ignores excluded categories', () => {
    const split = computeCycleEarn([buy(12_000_000), buy(9_000_000)], [], ancestors, { bonuses: [signature] });
    expect(split.eligibleSpendByBonus).toEqual({ sig: 21_000_000 });
    expect(split.bonusById).toEqual({ sig: 1000 });
    const utilities = computeCycleEarn([buy(15_000_000), buy(6_000_000, { categoryId: 'electricity' })], [], ancestors, { bonuses: [signature] });
    expect(utilities.eligibleSpendByBonus).toEqual({ sig: 15_000_000 });
    expect(utilities.bonusById).toEqual({ sig: 0 });
  });

  it('pays nothing when the bonus is not valid at the end of the cycle', () => {
    const future = { ...signature, validFrom: '2026-10-01' };
    expect(computeCycleEarn([buy(25_000_000)], [], ancestors, { bonuses: [future], cycleEnd: '2026-09-25' }).bonusById).toEqual({ sig: 0 });
  });

  it('reports the next unreached tier', () => {
    expect(nextBonusTier(infinite, 5_000_000)).toEqual({ minSpendMinor: 20_000_000, bonus: 1000 });
    expect(nextBonusTier(infinite, 25_000_000)).toEqual({ minSpendMinor: 50_000_000, bonus: 2000 });
    expect(nextBonusTier(infinite, 60_000_000)).toBeNull();
  });
});
