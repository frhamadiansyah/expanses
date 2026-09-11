import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type CycleBonus, type EarnRule, recommendCards, ruleMatches, type SpendLine } from '../src/index';

const ancestors = {};
const line = (over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId: 't1', entryId: 'e1', occurredOn: '2026-09-11', categoryId: 'dining', description: 'Merchant',
  amountMinor: 60_000, currency: 'IDR', originalCurrency: null, mcc: null, mccSource: null, ...over,
});
const rule = (over: Partial<EarnRule> = {}): EarnRule => ({
  id: 'r', name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 20_000, rounding: 'per_increment',
  capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null, ...over,
});

describe('MCC matching', () => {
  it('includes listed codes and ranges', () => {
    const travel = rule({ match: { mccs: ['5812', '3000-3299'] } });
    expect(ruleMatches(travel, line({ mcc: '5812', mccSource: 'category' }), ancestors)).toBe(true);
    expect(ruleMatches(travel, line({ mcc: '3140', mccSource: 'bundled' }), ancestors)).toBe(true);
    expect(ruleMatches(travel, line({ mcc: '5814', mccSource: 'memory' }), ancestors)).toBe(false);
  });

  it('never matches an MCC list when the purchase has no MCC', () => {
    expect(ruleMatches(rule({ match: { mccs: ['5812'] } }), line(), ancestors)).toBe(false);
  });

  it('excludes listed codes but not purchases without an MCC', () => {
    const base = rule({ match: { excludeMccs: ['5814', '9311'] } });
    expect(ruleMatches(base, line({ mcc: '5814', mccSource: 'memory' }), ancestors)).toBe(false);
    expect(ruleMatches(base, line({ mcc: '5812', mccSource: 'category' }), ancestors)).toBe(true);
    expect(ruleMatches(base, line(), ancestors)).toBe(true);
  });

  it('keeps excluded MCCs out of cycle bonus eligibility', () => {
    const bonus: CycleBonus = { id: 'b', key: 'b', name: 'Bonus', tiers: [{ minSpendMinor: 100_000, bonus: 500 }], match: { excludeMccs: ['5814'] }, validFrom: null, validTo: null };
    const lines = [
      line({ transactionId: 'a', entryId: 'a', amountMinor: 80_000, mcc: '5812', mccSource: 'category' }),
      line({ transactionId: 'b', entryId: 'b', amountMinor: 80_000, mcc: '5814', mccSource: 'memory' }),
    ];
    const earn = computeCycleEarn(lines, [rule()], ancestors, { bonuses: [bonus] });
    expect(earn.eligibleSpendByBonus.b).toBe(80_000);
    expect(earn.bonusById.b ?? 0).toBe(0);
  });

  it('uses the purchase MCC in recommendations', () => {
    const card = {
      cardAccountId: 'c', cardName: 'Card', currency: 'IDR', programName: 'TREATS', rules: [rule({ match: { excludeMccs: ['5814'] } })],
      bonuses: [], transferPartners: [], cycleLines: [], bestRedemption: null,
    };
    const query = { amountMinor: 60_000, currency: 'IDR', originalCurrency: null, categoryId: 'dining', description: 'McDonalds', occurredOn: '2026-09-11' };
    expect(recommendCards({ ...query, mcc: '5812' }, [card], ancestors)[0]!.points).toBe(3);
    expect(recommendCards({ ...query, mcc: '5814' }, [card], ancestors)[0]!.points).toBe(0);
  });
});
