import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cycleFor, previousCycle, statementCycleFor } from '../src/points/cycles';
import { computeCycleEarn, type EarnRule, type SpendLine } from '../src/points/earn';
import { recommendCards } from '../src/points/recommend';

const rule = (over: Partial<EarnRule> & Pick<EarnRule, 'id'>): EarnRule => ({
  name: over.id,
  priority: 0,
  stackable: false,
  match: {},
  rateNum: 1,
  rateDen: 2500,
  rounding: 'per_transaction_floor',
  capSpendMinor: null,
  capPoints: null,
  minTransactionMinor: null,
  validFrom: null,
  validTo: null,
  ...over,
});

let seq = 0;
const line = (categoryId: string, amountMinor: number, occurredOn = '2026-09-01', description = 'shop'): SpendLine => {
  seq += 1;
  const id = `t${String(seq).padStart(4, '0')}`;
  return { transactionId: id, entryId: `${id}e`, occurredOn, categoryId, description, amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null };
};

const ancestors = { groceries: ['food'], dining: ['food'], food: [], fuel: ['transport'], transport: [], fees: [] };

describe('statement cycles', () => {
  it('ends on the statement day and starts the day after the previous one', () => {
    expect(statementCycleFor('2026-09-11', 25)).toEqual({ start: '2026-08-26', end: '2026-09-25' });
    expect(statementCycleFor('2026-09-25', 25)).toEqual({ start: '2026-08-26', end: '2026-09-25' });
    expect(statementCycleFor('2026-09-26', 25)).toEqual({ start: '2026-09-26', end: '2026-10-25' });
  });
  it('clamps short months and crosses years', () => {
    expect(statementCycleFor('2026-02-15', 31)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(statementCycleFor('2026-03-01', 31)).toEqual({ start: '2026-03-01', end: '2026-03-31' });
    expect(statementCycleFor('2026-12-20', 5)).toEqual({ start: '2026-12-06', end: '2027-01-05' });
  });
  it('supports calendar anchors and previous cycles', () => {
    expect(cycleFor('2026-09-11', 'calendar', 25)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(previousCycle({ start: '2026-08-26', end: '2026-09-25' }, 'statement', 25)).toEqual({ start: '2026-07-26', end: '2026-08-25' });
  });
});

describe('computeCycleEarn', () => {
  const dining = rule({ id: 'dining', priority: 10, match: { categoryIds: ['food'] }, rateNum: 5, capSpendMinor: 3_000_000 });
  const base = rule({ id: 'base' });

  it('cascades spend beyond a bonus cap to the base rule (golden)', () => {
    const result = computeCycleEarn(
      [line('dining', 2_000_000, '2026-09-01'), line('dining', 1_500_000, '2026-09-02'), line('groceries', 10_000, '2026-09-03'), line('fuel', 7_499, '2026-09-04')],
      [base, dining],
      ancestors,
    );
    expect(result.pointsByRule).toEqual({ dining: 6000, base: 206 });
    expect(result.spendByRule).toEqual({ dining: 3_000_000, base: 517_499 });
    expect(result.totalPoints).toBe(6206);
    expect(result.unearnedSpendMinor).toBe(0);
    expect(result.allocations.filter((a) => a.spendMinor === 1_000_000 || a.spendMinor === 500_000).map((a) => [a.ruleId, a.points])).toEqual([
      ['dining', 2000],
      ['base', 200],
    ]);
  });

  it('distinguishes per-transaction floor from per-cycle sum rounding', () => {
    const lines = [line('fuel', 7000), line('fuel', 7000), line('fuel', 7000)];
    expect(computeCycleEarn(lines, [rule({ id: 'r' })], ancestors).totalPoints).toBe(6);
    const summed = computeCycleEarn(lines, [rule({ id: 'r', rounding: 'per_cycle_sum' })], ancestors);
    expect(summed.totalPoints).toBe(8);
    expect(summed.allocations.reduce((s, a) => s + a.points, 0)).toBe(8);
  });

  it('caps points, stacks promos, excludes categories, matches merchants and dates', () => {
    expect(computeCycleEarn([line('fuel', 3000), line('fuel', 4000)], [rule({ id: 'r', rateDen: 1000, capPoints: 5 })], ancestors).totalPoints).toBe(5);

    const stacked = computeCycleEarn([line('fuel', 20_000)], [base, rule({ id: 'promo', stackable: true, rateDen: 10_000 })], ancestors);
    expect(stacked.pointsByRule).toEqual({ base: 8, promo: 2 });

    const excluded = computeCycleEarn([line('fees', 50_000)], [rule({ id: 'b', match: { excludeCategoryIds: ['fees'] } })], ancestors);
    expect(excluded.totalPoints).toBe(0);
    expect(excluded.unearnedSpendMinor).toBe(50_000);

    const grab = rule({ id: 'grab', priority: 5, rateNum: 10, match: { merchantPatterns: ['grab'] } });
    expect(computeCycleEarn([line('transport', 2500, '2026-09-01', 'GRAB*FOOD JKT')], [base, grab], ancestors).pointsByRule).toEqual({ base: 0, grab: 10 });

    const promo = rule({ id: 'p', rateNum: 3, validFrom: '2026-09-10', validTo: '2026-09-20' });
    expect(computeCycleEarn([line('fuel', 2500, '2026-09-09'), line('fuel', 2500, '2026-09-15')], [promo], ancestors).totalPoints).toBe(3);

    expect(computeCycleEarn([line('fuel', 2400)], [rule({ id: 'm', minTransactionMinor: 2500 })], ancestors).totalPoints).toBe(0);
    expect(computeCycleEarn([line('fuel', -50_000)], [base], ancestors).totalPoints).toBe(0);
  });

  it('property: result is independent of input order and never negative', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ cat: fc.constantFrom('groceries', 'dining', 'fuel', 'fees'), amount: fc.integer({ min: -10_000, max: 5_000_000 }), day: fc.integer({ min: 1, max: 28 }) }), { maxLength: 20 }),
        (specs) => {
          const lines = specs.map((s, i) => ({ transactionId: `t${i}`, entryId: `e${i}`, occurredOn: `2026-09-${String(s.day).padStart(2, '0')}`, categoryId: s.cat, description: 'x', amountMinor: s.amount, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null }));
          const rules = [dining, base, rule({ id: 'promo', stackable: true, rateDen: 7, capPoints: 900 })];
          const a = computeCycleEarn(lines, rules, ancestors);
          const b = computeCycleEarn([...lines].reverse(), rules, ancestors);
          expect(b.pointsByRule).toEqual(a.pointsByRule);
          expect(a.totalPoints).toBeGreaterThanOrEqual(0);
          expect(a.spendByRule.dining).toBeLessThanOrEqual(3_000_000);
        },
      ),
    );
  });
});

describe('recommendCards', () => {
  it('ranks by marginal redemption value with cap headroom', () => {
    const cimbDining = rule({ id: 'cimb-dining', name: '5x dining', priority: 10, match: { categoryIds: ['food'] }, rateNum: 5, capSpendMinor: 3_000_000 });
    const cimbBase = rule({ id: 'cimb-base', name: 'Base' });
    const recs = recommendCards(
      { amountMinor: 1_000_000, currency: 'IDR', originalCurrency: null, mcc: null, categoryId: 'dining', description: 'Sushi Tei', occurredOn: '2026-09-11' },
      [
        { cardAccountId: 'bca', cardName: 'BCA Visa', currency: 'IDR', programName: null, bonuses: [], transferPartners: [], rules: [rule({ id: 'bca-base' })], cycleLines: [], bestRedemption: { valueMinor: 10, perPoints: 1, currency: 'IDR' } },
        { cardAccountId: 'cimb', cardName: 'CIMB Octo', currency: 'IDR', programName: null, bonuses: [], transferPartners: [], rules: [cimbDining, cimbBase], cycleLines: [line('dining', 2_500_000, '2026-09-02')], bestRedemption: { valueMinor: 25, perPoints: 1, currency: 'IDR' } },
        { cardAccountId: 'usd', cardName: 'USD Card', currency: 'USD', programName: null, bonuses: [], transferPartners: [], rules: [rule({ id: 'usd' })], cycleLines: [], bestRedemption: null },
      ],
      ancestors,
    );
    expect(recs.map((r) => [r.cardAccountId, r.points, r.valueMinor, r.effectiveRateBps, r.eligible])).toEqual([
      ['cimb', 1200, 30_000, 300, true],
      ['bca', 400, 4_000, 40, true],
      ['usd', 0, null, null, false],
    ]);
    expect(recs[0]!.capHeadroom).toEqual([{ ruleId: 'cimb-dining', ruleName: '5x dining', remainingMinor: 500_000 }]);
  });
});

describe('review fixes: points caps and whole transactions', () => {
  const base = rule({ id: 'base' });

  it('passes spend beyond a points cap down to the next rule', () => {
    const bonus = rule({ id: 'bonus', priority: 10, match: { categoryIds: ['food'] }, rateNum: 10, capPoints: 100 });
    const result = computeCycleEarn([line('dining', 250_000)], [base, bonus], ancestors);
    expect(result.pointsByRule).toEqual({ base: 90, bonus: 100 });
    expect(result.spendByRule).toEqual({ base: 225_000, bonus: 25_000 });
  });

  it('rounds and applies minimum spend per transaction, not per split line', () => {
    const split = (amounts: number[]): SpendLine[] =>
      amounts.map((amountMinor, i) => ({ transactionId: 'split1', entryId: `s${i}`, occurredOn: '2026-09-05', categoryId: i ? 'fuel' : 'groceries', description: 'Superindo', amountMinor, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null }));
    const perTx = computeCycleEarn(split([2000, 2000]), [base], ancestors);
    expect(perTx.totalPoints).toBe(1);
    expect(perTx.allocations.reduce((s, a) => s + a.points, 0)).toBe(1);
    expect(computeCycleEarn(split([400_000, 200_000]), [rule({ id: 'min', rateDen: 1000, minTransactionMinor: 500_000 })], ancestors).totalPoints).toBe(600);
  });
});
