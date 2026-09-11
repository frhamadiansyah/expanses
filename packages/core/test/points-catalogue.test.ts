import { describe, expect, it } from 'vitest';
import { computeCycleEarn, type EarnRule, ruleMatches, type SpendLine } from '../src/points/earn';

const rule = (over: Partial<EarnRule> & Pick<EarnRule, 'id'>): EarnRule => ({
  name: over.id,
  priority: 0,
  stackable: false,
  match: {},
  rateNum: 1,
  rateDen: 10_000,
  rounding: 'per_transaction_floor',
  capSpendMinor: null,
  capPoints: null,
  minTransactionMinor: null,
  validFrom: null,
  validTo: null,
  ...over,
});

const line = (over: Partial<SpendLine> = {}): SpendLine => ({
  transactionId: 't1',
  entryId: 'e1',
  occurredOn: '2026-09-05',
  categoryId: 'dining',
  description: 'Merchant',
  amountMinor: 540_000,
  currency: 'IDR',
  originalCurrency: null,
  ...over,
});

const ancestors = { dining: ['food'], food: [] };

describe('original currency matching', () => {
  const base = rule({ id: 'base' });
  const double = rule({ id: 'double', stackable: true, match: { currencies: ['SGD', 'HKD', 'CNY', 'TWD'] } });

  it('UnionPay double rule matches an SGD purchase billed in IDR', () => {
    expect(computeCycleEarn([line({ originalCurrency: 'SGD' })], [base, double], ancestors).pointsByRule).toEqual({ base: 54, double: 54 });
  });

  it('an IDR purchase does not match the SGD-only rule', () => {
    expect(computeCycleEarn([line()], [base, double], ancestors).pointsByRule).toEqual({ base: 54, double: 0 });
  });

  it('falls back to the billed currency when no original currency is recorded', () => {
    expect(ruleMatches(rule({ id: 'idr', match: { currencies: ['IDR'] } }), line(), ancestors)).toBe(true);
  });
});

describe('merchant exclusions', () => {
  it('rejects Prudential case-insensitively and keeps other merchants', () => {
    const base = rule({ id: 'base', match: { excludeMerchantPatterns: ['prudential'] } });
    expect(ruleMatches(base, line({ description: 'PRUDENTIAL LIFE ASSURANCE' }), ancestors)).toBe(false);
    expect(ruleMatches(base, line({ description: 'Sushi Tei' }), ancestors)).toBe(true);
  });
});
