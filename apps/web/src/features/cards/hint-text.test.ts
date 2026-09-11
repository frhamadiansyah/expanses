import { computeCycleEarn, type CycleBonus, type EarnRule, type SpendLine } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { checkedTotals, describeSuggestion, purchasesOf } from './hint-text';
import type { CycleResult } from './useCardPoints';

const line = (transactionId: string, amountMinor: number, over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId, entryId: `${transactionId}-1`, occurredOn: '2026-09-05', categoryId: 'dining', description: transactionId.toUpperCase(),
  amountMinor, currency: 'IDR', originalCurrency: null, mcc: '5812', mccSource: 'category', ...over,
});
const base: EarnRule = {
  id: 'base', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20_000, rounding: 'per_increment',
  capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
};
const bonus: CycleBonus = { id: 'm', key: 'm', name: 'Milestone', tiers: [{ minSpendMinor: 50_000, bonus: 100 }], match: {}, validFrom: null, validTo: null };

function cycle(lines: SpendLine[], actual: number | null = null): CycleResult {
  const options = { bonuses: [bonus], cycleEnd: '2026-09-25' };
  return { cycle: { start: '2026-08-26', end: '2026-09-25' }, lines, earn: computeCycleEarn(lines, [base], {}, options), actual, context: { lines, rules: [base], ancestors: {}, options } };
}

describe('purchasesOf', () => {
  it('groups split lines into one purchase in order', () => {
    const rows = purchasesOf([line('a', 30_000), line('a', 20_000, { entryId: 'a-2', mcc: '5411' }), line('b', 10_000)]);
    expect(rows.map((r) => [r.transactionId, r.amountMinor, r.mcc])).toEqual([['a', 50_000, '5812'], ['b', 10_000, '5812']]);
  });
});

describe('checkedTotals', () => {
  const lines = [line('a', 60_000), line('b', 40_000), line('refund', -20_000)];

  it('adds actuals for checked purchases, estimates for the rest, and the estimated bonus', () => {
    expect(checkedTotals(cycle(lines), [{ transactionId: 'a', actualPoints: 0, editedAfterCheck: false, recordedAt: '2026-09-06' }])).toEqual({ checked: 1, purchases: 3, total: 101 });
  });

  it('uses the bonus points credited when recorded', () => {
    expect(checkedTotals(cycle(lines, 150), [])).toEqual({ checked: 0, purchases: 3, total: 154 });
  });
});

describe('describeSuggestion', () => {
  it('words MCC, bonus threshold, and rounding suggestions', () => {
    expect(describeSuggestion({ kind: 'mcc', transactionId: 'a', mcc: '5814', pointsWith: 0, moves: -9 }, 'points', 'IDR', { a: 'MCDONALD SENAYAN' })).toBe(
      'MCDONALD SENAYAN as MCC 5814 Fast Food Restaurants would earn 0 points (-9 on the cycle).',
    );
    expect(describeSuggestion({ kind: 'bonus_threshold', bonusId: 'm', eligibleSpendMinor: 20_000_000, tierMinSpendMinor: 20_000_000, bonus: 1000 }, 'miles', 'IDR')).toMatch(
      /Rp\s20\.000\.000 counted toward the bonus, right at the Rp\s20\.000\.000 threshold for 1\.000 miles/,
    );
    expect(describeSuggestion({ kind: 'rounding', points: -1 }, 'points', 'IDR')).toBe('A difference of 1 points can come from how the bank rounds each purchase.');
  });
});
