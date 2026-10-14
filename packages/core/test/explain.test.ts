import { describe, expect, it } from 'vitest';
import { candidateMccs, type CycleBonus, type CycleContext, type EarnRule, explainCycle, explainTransaction, type SpendLine } from '../src/index';

const line = (transactionId: string, amountMinor: number, mcc: string | null, over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId, entryId: `${transactionId}-1`, occurredOn: '2026-09-05', categoryId: 'dining', description: transactionId.toUpperCase(),
  amountMinor, currency: 'IDR', originalCurrency: null, mcc, mccSource: mcc ? 'category' : null, ...over,
});
const rule = (over: Partial<EarnRule> = {}): EarnRule => ({
  id: 'base', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20_000, rounding: 'per_increment',
  capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null, ...over,
});
// Maybank-style terms: base excludes fast food and tax; restaurants and supermarkets earn 2 extra.
const base = rule({ match: { excludeMccs: ['5814', '9311'] } });
const extra = rule({ id: 'extra', stackable: true, rateNum: 2, match: { mccs: ['5812', '5411'], excludeMccs: ['5814'] } });
const context = (lines: SpendLine[], rules: EarnRule[] = [base, extra], bonuses: CycleBonus[] = []): CycleContext => ({ lines, rules, ancestors: {}, options: { bonuses } });

describe('candidateMccs', () => {
  it('lists single codes and range starts once, sorted', () => {
    expect(candidateMccs([base, extra, rule({ id: 'travel', match: { mccs: ['3000-3299', '5812'] } })])).toEqual(['3000', '5411', '5812', '5814', '9311']);
  });
});

describe('explainTransaction', () => {
  it('suggests the codes that make a dinner earn the 0 points the bank credited', () => {
    expect(explainTransaction(context([line('dinner', 60_000, '5812')]), 'dinner', 0)).toEqual([
      { kind: 'mcc', transactionId: 'dinner', mcc: '5814', pointsWith: 0, moves: -9 },
      { kind: 'mcc', transactionId: 'dinner', mcc: '9311', pointsWith: 0, moves: -9 },
    ]);
  });

  it('never second-guesses a typed or remembered MCC, and is silent when the actual matches', () => {
    expect(explainTransaction(context([line('dinner', 60_000, '5812', { mccSource: 'memory' })]), 'dinner', 0)).toEqual([]);
    expect(explainTransaction(context([line('dinner', 60_000, '5812', { mccSource: 'typed' })]), 'dinner', 0)).toEqual([]);
    expect(explainTransaction(context([line('dinner', 60_000, '5812')]), 'dinner', 9)).toEqual([]);
  });
});

describe('explainCycle', () => {
  const lines = [line('dinner', 60_000, '5812'), line('groceries', 40_000, '5411'), line('taxi', 100_000, '4121')];

  it('ranks the purchase whose MCC closes most of the gap first, and respects the limit', () => {
    const suggestions = explainCycle(context(lines), 11, 2);
    expect(suggestions.map((s) => (s.kind === 'mcc' ? [s.transactionId, s.mcc, s.moves] : s.kind))).toEqual([
      ['dinner', '5814', -9],
      ['groceries', '5814', -6],
    ]);
    expect(explainCycle(context(lines), 20)).toEqual([]);
  });

  it('points to a bonus tier when the gap equals its bonus near the threshold', () => {
    const bonus: CycleBonus = { id: 'milestone', key: 'milestone', name: 'Milestone', tiers: [{ minSpendMinor: 100_000, bonus: 500 }], match: {}, validFrom: null, validTo: null };
    const withBonus = context([line('a', 60_000, null), line('b', 40_000, null)], [rule()], [bonus]);
    expect(explainCycle(withBonus, 5)).toEqual([{ kind: 'bonus_threshold', bonusId: 'milestone', eligibleSpendMinor: 100_000, tierMinSpendMinor: 100_000, bonus: 500 }]);
  });

  it('suggests rounding when the gap is smaller than the number of purchases', () => {
    expect(explainCycle(context([line('a', 60_000, null), line('b', 40_000, null)], [rule()]), 4)).toEqual([{ kind: 'rounding', points: -1 }]);
  });
});

describe('a purchase typed with cents', () => {
  it('is explained on the figure it earns on, not the one it was charged', () => {
    // Charged 20.001, earned on 20.000: the stackable rule from 20.001 never applies, so as a restaurant (5812) it
    // earns the base point alone — the 1 the bank gave. On the charged figure it would earn 2 and nothing would fit.
    const plain = rule({ match: { excludeMccs: ['5814'] } });
    const from20001 = rule({ id: 'extra', stackable: true, minTransactionMinor: 20_001, match: { mccs: ['5812'] } });
    const exact = line('dinner', 20_001, '5814', { earnMinor: 20_000 });
    expect(explainTransaction(context([exact], [plain, from20001]), 'dinner', 1)).toEqual([{ kind: 'mcc', transactionId: 'dinner', mcc: '5812', pointsWith: 1, moves: 1 }]);
  });
});
