import { describe, expect, it } from 'vitest';
import { ruleQualifiers } from './rule-summary';

const money = (minor: number) => `Rp ${minor.toLocaleString('id-ID')}`;
const of = (over: Record<string, unknown>) => ({ minTransactionMinor: null, minCycleSpendMinor: null, ...over }) as never;

const name = (id: string) => ({ 'c-dining': 'Dining Out', 'c-coffee': 'Coffee & Snacks' })[id] ?? '?';

describe('what narrows an earn rule', () => {
  it('names the categories when the rule matches on them', () => {
    expect(ruleQualifiers(of({ match: { categoryIds: ['c-dining', 'c-coffee'] } }), name, money)).toEqual(['Dining Out, Coffee & Snacks']);
  });

  it('names the merchant category codes, which used to read as "all categories"', () => {
    expect(ruleQualifiers(of({ match: { mccs: ['5462', '5499', '5813-5814'] } }), name, money)).toEqual(['MCC 5462, 5499, 5813-5814']);
  });

  it('counts the rest when a rule carries a long list, as the travel category does', () => {
    const specs = ['3000-3068', '3071-3072', '3075-3079', '3081-3090', '3094', '3096-3100'];
    expect(ruleQualifiers(of({ match: { mccs: specs } }), name, money)).toEqual(['MCC 3000-3068, 3071-3072, 3075-3079, 3081-3090 and 2 more']);
  });

  it('says a foreign rule is spent abroad rather than all categories', () => {
    expect(ruleQualifiers(of({ match: { origin: 'foreign' } }), name, money)).toEqual(['spent abroad']);
  });

  it('combines what narrows a rule, in a fixed order', () => {
    expect(ruleQualifiers(of({ match: { categoryIds: ['c-dining'], mccs: ['5812'], origin: 'foreign', merchantPatterns: ['qris'] } }), name, money)).toEqual([
      'Dining Out',
      'MCC 5812',
      'spent abroad',
      'merchants: qris',
    ]);
  });

  it('is empty for a rule that matches every purchase', () => {
    expect(ruleQualifiers(of({ match: {} }), name, money)).toEqual([]);
  });
});

describe('a rule with a floor', () => {
  it('says the cycle has to reach the floor, not each purchase', () => {
    expect(ruleQualifiers(of({ match: {}, minCycleSpendMinor: 1_500_000 }), name, money)).toEqual(['once the cycle reaches Rp 1.500.000']);
  });

  it('distinguishes a floor per purchase from a floor per cycle', () => {
    expect(ruleQualifiers(of({ match: {}, minTransactionMinor: 1_500_000 }), name, money)).toEqual(['purchases over Rp 1.500.000']);
  });
});
