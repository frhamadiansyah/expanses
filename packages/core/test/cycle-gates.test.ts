import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type EarnRule, type SpendLine } from '../src/index';

const line = (transactionId: string, amountMinor: number, description = 'Belanja'): SpendLine => ({
  transactionId, entryId: `${transactionId}e`, occurredOn: '2026-09-10', categoryId: 'shopping', description,
  amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, cardFee: false,
});

const rule = (over: Partial<EarnRule>): EarnRule => ({
  id: 'r', name: 'Rule', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20,
  rounding: 'per_increment', capSpendMinor: null, capPoints: null, minTransactionMinor: null,
  minCycleSpendMinor: null, validFrom: null, validTo: null, ...over,
});

const earn = (lines: SpendLine[], rules: EarnRule[]) => computeCycleEarn(lines, rules, {}).totalPoints;

describe('a floor on the cycle as a whole', () => {
  const gated = rule({ minCycleTotalMinor: 5_000_000, match: { merchantPatterns: ['tokopedia'] } });

  it('counts spending the rule itself does not match, which minCycleSpendMinor cannot', () => {
    // Rp 3jt online and Rp 3jt elsewhere: the cycle reaches the floor, though the matching spend does not.
    const mixed = [line('a', 3_000_000, 'Tokopedia'), line('b', 3_000_000, 'Superindo')];
    expect(earn(mixed, [gated])).toBe(150_000);
    expect(earn(mixed, [rule({ ...gated, minCycleTotalMinor: null, minCycleSpendMinor: 5_000_000 })])).toBe(0);
  });

  it('shuts the rule off for the whole cycle when the floor is not reached', () => {
    expect(earn([line('a', 4_999_999, 'Tokopedia')], [gated])).toBe(0);
    expect(earn([line('a', 5_000_000, 'Tokopedia')], [gated])).toBe(250_000);
  });

  it('is measured net of refunds', () => {
    const refunded = [line('a', 6_000_000, 'Tokopedia'), { ...line('b', -2_000_000, 'Tokopedia'), entryId: 'be' }];
    expect(earn(refunded, [gated])).toBe(0);
  });
});

describe('a count of qualifying purchases', () => {
  const gated = rule({ minCyclePurchases: 5, minCyclePurchaseMinor: 100_000 });
  const of = (n: number, each: number) => Array.from({ length: n }, (_, i) => line(`t${i}`, each));

  it('earns once the cycle holds enough purchases of the size asked for', () => {
    expect(earn(of(4, 200_000), [gated])).toBe(0);
    expect(earn(of(5, 200_000), [gated])).toBe(50_000);
  });

  it('does not count purchases below the size, however many there are', () => {
    expect(earn(of(20, 99_999), [gated])).toBe(0);
  });

  it('counts a split purchase once, by its whole total', () => {
    // One purchase of Rp 150.000 split across two categories is one purchase, not two.
    const split = [
      { ...line('s', 75_000), entryId: 's1' },
      { ...line('s', 75_000), entryId: 's2' },
      ...of(4, 200_000),
    ];
    expect(earn(split, [gated])).toBe(47_500);
  });

  it('takes any purchase when no size is given', () => {
    expect(earn(of(5, 1_000), [rule({ minCyclePurchases: 5 })])).toBe(250);
  });
});

describe('the two gates together', () => {
  const gated = rule({ id: 'g', minCycleTotalMinor: 1_000_000, minCyclePurchases: 3, minCyclePurchaseMinor: 100_000 });
  const plain = rule({ id: 'p' });
  // Rp 1.000.000 in one purchase and two small ones: the total is there, the count of big purchases is not.
  const lopsided = [line('a', 1_000_000), line('b', 50_000), line('c', 50_000)];

  it('earns when the cycle satisfies both', () => {
    expect(earn([line('a', 400_000), line('b', 400_000), line('c', 400_000)], [gated])).toBe(60_000);
  });

  it('earns nothing when either is short', () => {
    expect(earn(lopsided, [gated])).toBe(0);
    // Three big purchases, but the cycle never reaches Rp 1.000.000.
    expect(earn([line('a', 300_000), line('b', 300_000), line('c', 300_000)], [gated])).toBe(0);
  });

  it('leaves a rule without gates earning on the same cycle', () => {
    expect(earn(lopsided, [plain])).toBe(55_000);
  });
});
