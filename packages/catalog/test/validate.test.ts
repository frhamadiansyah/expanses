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

  it('accepts a step published in partner units when it agrees with the step in points', () => {
    // The fixture is 200 points to 100 units, so a 500-unit block is 1.000 points.
    expect(errorsFor((e) => {
      e.transferPartners[0]!.incrementPoints = 1000;
      e.transferPartners[0]!.incrementPartnerUnits = 500;
    })).toEqual([]);
  });

  it('accepts a minimum larger than the step, and leaves it out where the step is the only floor', () => {
    expect(errorsFor((e) => { e.transferPartners[0]!.minimumPoints = 100; })).toEqual([]);
    expect(errorsFor((e) => { e.transferPartners[0]!.minimumPoints = 20; })).toEqual([]);
    expect(errorsFor(() => undefined)).toEqual([]);
  });

  it('accepts a redemption cap measured either way, with or without a ratio past it', () => {
    expect(errorsFor((e) => { e.transferPartners[0]!.cap = { window: 'month', capPoints: 25_000, shared: true, beyondPoints: 3000, beyondPartnerUnits: 1000 }; })).toEqual([]);
    expect(errorsFor((e) => { e.transferPartners[0]!.cap = { window: 'year', capPartnerUnits: 30_000 }; })).toEqual([]);
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
    ['a cap with no ceiling', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.cap = { window: 'month' }; }, /exactly one of capPoints/],
    ['a cap measured two ways at once', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.cap = { window: 'month', capPoints: 1000, capPartnerUnits: 1000 }; }, /exactly one of capPoints/],
    ['a cap on an unknown window', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.cap = { window: 'week' as 'month', capPoints: 1000 }; }, /window/],
    ['half a reduced ratio', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.cap = { window: 'month', capPoints: 1000, beyondPoints: 3000 }; }, /beyondPoints and beyondPartnerUnits/],
    ['a ceiling of zero', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.cap = { window: 'month', capPoints: 0 }; }, /capPoints/],
    ['a step in partner units that contradicts the step in points', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.incrementPartnerUnits = 500; }, /must be 1000 to match/],
    ['a minimum below the step', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.minimumPoints = 10; }, /at least incrementPoints/],
    ['a minimum of zero', (e: ReturnType<typeof valid>) => { e.transferPartners[0]!.minimumPoints = 0; }, /minimumPoints/],
  ])('rejects %s', (_name, mutate, pattern) => {
    const errors = errorsFor(mutate);
    expect(errors.some((message) => pattern.test(message)), errors.join(' | ')).toBe(true);
  });
});

describe('card look', () => {
  const look = {
    orientation: 'landscape',
    colours: ['#0b2545', '#13315c'],
    angle: 135,
    finish: 'metallic',
    pattern: 'arcs',
    patternColour: '#ffffff22',
    ink: 'light',
    wordmark: 'KrisFlyer',
    chip: 'gold',
  } as const;

  it('accepts a described card face, and an entry without one', () => {
    expect(validateEntry({ ...valid(), look }, new Set(DEFAULT_CATEGORY_KEYS))).toEqual([]);
    expect(validateEntry(valid(), new Set(DEFAULT_CATEGORY_KEYS))).toEqual([]);
  });

  it('names what is wrong with a look', () => {
    const errors = validateEntry({ ...valid(), look: { ...look, colours: ['navy'], pattern: 'tartan', wordmark: '', motif: 'paisley' } }, new Set(DEFAULT_CATEGORY_KEYS));
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/^look.colours/), expect.stringMatching(/^look.pattern/), expect.stringMatching(/^look.wordmark/), expect.stringMatching(/^look.motif/)]));
  });
});
