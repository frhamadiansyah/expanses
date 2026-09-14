import { describe, expect, it } from 'vitest';
import { ruleQualifiers } from './rule-summary';

const name = (id: string) => ({ 'c-dining': 'Dining Out', 'c-coffee': 'Coffee & Snacks' })[id] ?? '?';

describe('what narrows an earn rule', () => {
  it('names the categories when the rule matches on them', () => {
    expect(ruleQualifiers({ categoryIds: ['c-dining', 'c-coffee'] }, name)).toEqual(['Dining Out, Coffee & Snacks']);
  });

  it('names the merchant category codes, which used to read as "all categories"', () => {
    expect(ruleQualifiers({ mccs: ['5462', '5499', '5813-5814'] }, name)).toEqual(['MCC 5462, 5499, 5813-5814']);
  });

  it('counts the rest when a rule carries a long list, as the travel category does', () => {
    const specs = ['3000-3068', '3071-3072', '3075-3079', '3081-3090', '3094', '3096-3100'];
    expect(ruleQualifiers({ mccs: specs }, name)).toEqual(['MCC 3000-3068, 3071-3072, 3075-3079, 3081-3090 and 2 more']);
  });

  it('says a foreign rule is spent abroad rather than all categories', () => {
    expect(ruleQualifiers({ origin: 'foreign' }, name)).toEqual(['spent abroad']);
  });

  it('combines what narrows a rule, in a fixed order', () => {
    expect(ruleQualifiers({ categoryIds: ['c-dining'], mccs: ['5812'], origin: 'foreign', merchantPatterns: ['qris'] }, name)).toEqual([
      'Dining Out',
      'MCC 5812',
      'spent abroad',
      'merchants: qris',
    ]);
  });

  it('is empty for a rule that matches every purchase', () => {
    expect(ruleQualifiers({}, name)).toEqual([]);
  });
});
