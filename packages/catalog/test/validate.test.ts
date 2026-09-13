import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/types';
import { validateEntry } from '../src/validate';

const valid = (): CatalogEntry => ({
  id: 'test-card',
  entryVersion: 1,
  bank: 'Test Bank',
  name: 'Test Card',
  network: 'visa',
  currency: 'IDR',
  program: { unit: 'points', name: 'Test Points', cycleAnchor: 'statement' },
  fees: [{ effectiveFrom: null, effectiveTo: null, annualFeeMinor: 500000, supplementaryFeeMinor: 250000 }],
  terms: [
    {
      effectiveFrom: null,
      effectiveTo: '2025-12-31',
      rules: [{ key: 'base', name: 'Base', rateNum: 1, rateDen: 10000, rounding: 'per_transaction_floor', priority: 0, stackable: false, match: { excludeCategoryKeys: ['miscellaneous.fees_charges'] } }],
      cycleBonuses: [{ key: 'monthly', name: 'Monthly', tiers: [{ minSpendMinor: 20000000, bonus: 1000 }, { minSpendMinor: 50000000, bonus: 2000 }], match: {} }],
    },
    {
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      rules: [{ key: 'base', name: 'Base', rateNum: 7.5, rateDen: 50000, rounding: 'per_increment', priority: 0, stackable: false, match: { origin: 'domestic' } }],
      cycleBonuses: [],
    },
  ],
  transferPartners: [{ key: 'krisflyer', program: 'KrisFlyer', points: 200, partnerUnits: 100, incrementPoints: 20, effectiveFrom: null, effectiveTo: null }],
  cashValue: { valueMinor: 20, perPoints: 1, currency: 'IDR' },
  welcomeBonus: null,
  notes: [],
  sources: [{ title: 'Bank page', url: 'https://example.com/card' }],
  verifiedOn: '2026-09-11',
});

const errorsFor = (mutate: (entry: ReturnType<typeof valid>) => unknown) => {
  const entry = valid();
  const result = mutate(entry) ?? entry;
  return validateEntry(result, DEFAULT_CATEGORY_KEYS);
};

describe('validateEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(valid(), DEFAULT_CATEGORY_KEYS)).toEqual([]);
  });

  it.each([
    ['missing sources', (e: ReturnType<typeof valid>) => { e.sources = []; }, /sources/],
    ['missing verifiedOn', (e: ReturnType<typeof valid>) => { (e as { verifiedOn?: string }).verifiedOn = undefined; }, /verifiedOn/],
    ['overlapping periods', (e: ReturnType<typeof valid>) => { e.terms[1]!.effectiveFrom = '2025-12-01'; }, /overlap/],
    ['unordered periods', (e: ReturnType<typeof valid>) => { e.terms.reverse(); }, /order|overlap/],
    ['descending tiers', (e: ReturnType<typeof valid>) => { e.terms[0]!.cycleBonuses[0]!.tiers.reverse(); }, /ascending/],
    ['zero rateDen', (e: ReturnType<typeof valid>) => { e.terms[0]!.rules[0]!.rateDen = 0; }, /rateDen/],
    ['unknown category key', (e: ReturnType<typeof valid>) => { e.terms[0]!.rules[0]!.match = { excludeCategoryKeys: ['groceries'] }; }, /unknown category key/],
    ['duplicate rule key', (e: ReturnType<typeof valid>) => { e.terms[0]!.rules.push({ ...e.terms[0]!.rules[0]! }); }, /duplicate/],
    ['two-decimal rate', (e: ReturnType<typeof valid>) => { e.terms[1]!.rules[0]!.rateNum = 7.25; }, /one decimal/],
    ['statement day 32', (e: ReturnType<typeof valid>) => { (e.program as { fixedStatementDay?: number }).fixedStatementDay = 32; }, /fixedStatementDay/],
  ])('rejects %s', (_name, mutate, pattern) => {
    const errors = errorsFor(mutate);
    expect(errors.some((message) => pattern.test(message)), errors.join(' | ')).toBe(true);
  });
});
