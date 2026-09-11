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
  mcc: null,
  mccSource: null,
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

describe('whole-word keywords', () => {
  it('matches words and phrases only at non-alphanumeric boundaries', async () => {
    const { containsKeyword } = await import('../src/text/keywords');
    expect(containsKeyword('VA BCA 8808123', 'va')).toBe(true);
    expect(containsKeyword('Kopi Java Bali', 'va')).toBe(false);
    expect(containsKeyword('GRAB*FOOD JKT', 'grab')).toBe(true);
    expect(containsKeyword('THE ST. REGIS JAKARTA', 'st. regis')).toBe(true);
    expect(containsKeyword('Prudential Life Assurance', 'PRUDENTIAL')).toBe(true);
    expect(containsKeyword('Taxation office', 'axa')).toBe(false);
  });

  it('applies whole-word matching to rule exclusions', () => {
    const noVa = rule({ id: 'base', match: { excludeMerchantPatterns: ['va'] } });
    expect(ruleMatches(noVa, line({ description: 'Java Coffee' }), ancestors)).toBe(true);
    expect(ruleMatches(noVa, line({ description: 'Pembayaran VA Tokopedia' }), ancestors)).toBe(false);
  });
});

describe('domestic and foreign origin', () => {
  const foreign = rule({ id: 'foreign', match: { origin: 'foreign' } });
  const domestic = rule({ id: 'domestic', match: { origin: 'domestic' } });

  it('treats a non-rupiah original currency on an IDR card as foreign', () => {
    expect(ruleMatches(foreign, line({ originalCurrency: 'CNY' }), ancestors)).toBe(true);
    expect(ruleMatches(domestic, line({ originalCurrency: 'CNY' }), ancestors)).toBe(false);
  });

  it('treats rupiah purchases, with or without an original currency, as domestic', () => {
    expect(ruleMatches(domestic, line(), ancestors)).toBe(true);
    expect(ruleMatches(domestic, line({ originalCurrency: 'IDR' }), ancestors)).toBe(true);
    expect(ruleMatches(foreign, line(), ancestors)).toBe(false);
  });
});
