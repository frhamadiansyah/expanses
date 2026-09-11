import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type CycleBonus, type EarnRule, explainCycle, explainTransaction, type SpendLine } from '../src/index';

const rule = (over: Partial<EarnRule> = {}): EarnRule => ({
  id: 'base', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20_000, rounding: 'per_increment',
  capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null, ...over,
});
const line = (transactionId: string, description: string, amountMinor: number, occurredOn: string, over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId, entryId: `${transactionId}-1`, occurredOn, categoryId: 'dining', description, amountMinor,
  currency: 'IDR', originalCurrency: null, mcc: '5812', mccSource: 'category', ...over,
});

describe('refunds reverse the purchase they refund', () => {
  // Maybank Platinum style: base plus a capped restaurant extra.
  const rules = [rule(), rule({ id: 'extra', stackable: true, rateNum: 2, capPoints: 2500, match: { mccs: ['5812'] } })];
  const a = line('a', 'DIN TAI FUNG', 25_000_000, '2026-09-05');
  const b = line('b', 'SUSHI TEI', 10_000_000, '2026-09-06');

  it('takes back only what the refunded purchase earned when a cap was already reached', () => {
    expect(computeCycleEarn([a], rules, {}).totalPoints).toBe(3750);
    expect(computeCycleEarn([a, b], rules, {}).totalPoints).toBe(4250);
    const earn = computeCycleEarn([a, b, line('r', 'REFUND SUSHI TEI', -10_000_000, '2026-09-08')], rules, {});
    expect(earn.totalPoints).toBe(3750);
    expect(earn.pointsByTransaction.r).toBe(-500);
  });

  it('reverses a partial refund in proportion to the purchase', () => {
    expect(computeCycleEarn([a, line('r', 'DIN TAI FUNG', -5_000_000, '2026-09-08')], rules, {}).totalPoints).toBe(3000);
  });

  it('falls back to deducting by rule when no purchase matches the refund', () => {
    expect(computeCycleEarn([a, line('r', 'UNKNOWN MERCHANT', -1_000_000, '2026-09-08')], rules, {}).totalPoints).toBe(3600);
  });
});

describe('cycle bonuses across a change of terms', () => {
  it('adds spend under each period and pays the row valid at the end of the cycle', () => {
    const before: CycleBonus = { id: 'old', key: 'monthly-spend', name: 'Monthly spend bonus', tiers: [{ minSpendMinor: 20_000_000, bonus: 1000 }], match: {}, validFrom: '2024-08-12', validTo: '2025-09-22' };
    const after: CycleBonus = { ...before, id: 'new', validFrom: '2025-09-23', validTo: null };
    const lines = [line('x', 'SHOP', 12_000_000, '2025-09-15'), line('y', 'SHOP', 12_000_000, '2025-09-30')];
    const earn = computeCycleEarn(lines, [rule({ rounding: 'per_transaction_floor', rateDen: 13_500 })], {}, { bonuses: [before, after], cycleEnd: '2025-10-09' });
    expect(earn.bonusById).toEqual({ old: 0, new: 1000 });
    expect(earn.eligibleSpendByBonus).toEqual({ old: 24_000_000, new: 24_000_000 });
  });
});

describe('explanations stay the same with fewer recomputations', () => {
  const base = rule({ match: { excludeMccs: ['5814', '9311'] } });
  const extra = rule({ id: 'extra', stackable: true, rateNum: 2, match: { mccs: ['5812', '5411', '3000-3299'], excludeMccs: ['5814'] } });
  const context = (lines: SpendLine[]) => ({ lines, rules: [base, extra], ancestors: {}, options: {} });

  it('still lists every code that reproduces a per-purchase actual', () => {
    expect(explainTransaction(context([line('d', 'DINNER', 60_000, '2026-09-05')]), 'd', 0).map((s) => (s.kind === 'mcc' ? s.mcc : s.kind))).toEqual(['5814', '9311']);
  });

  it('handles a busy cycle quickly', () => {
    const lines = Array.from({ length: 200 }, (_, i) => line(`p${i}`, `MERCHANT ${i}`, 50_000 + i * 1_000, '2026-09-05'));
    const started = performance.now();
    const suggestions = explainCycle(context(lines), 0);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
