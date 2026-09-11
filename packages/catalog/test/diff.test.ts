import { describe, expect, it } from 'vitest';
import { diffCatalogEntries } from '../src/diff';
import { CATALOG, findEntry } from '../src/index';
import type { CatalogEntry } from '../src/types';

const clone = (id: string): CatalogEntry => structuredClone(findEntry(id)!);

describe('diffCatalogEntries', () => {
  it('returns [] for identical entries', () => {
    for (const entry of CATALOG) expect(diffCatalogEntries(clone(entry.id), clone(entry.id)), entry.id).toEqual([]);
  });

  it('reports a base rate change 13.500 → 15.000', () => {
    const current = clone('bca-sq-krisflyer-visa-signature');
    current.terms[1]!.rules[0]!.rateDen = 15000;
    const lines = diffCatalogEntries(clone('bca-sq-krisflyer-visa-signature'), current);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Base \(from 2025-09-23\): 1 mile per Rp 13\.500.* → 1 mile per Rp 15\.000/);
  });

  it('reports an added excluded merchant', () => {
    const current = clone('bca-sq-krisflyer-visa-signature');
    current.terms[1]!.rules[0]!.match.excludeMerchantPatterns!.push('axa');
    expect(diffCatalogEntries(clone('bca-sq-krisflyer-visa-signature'), current)).toEqual(['Base (from 2025-09-23): now excludes merchants matching axa.']);
  });

  it('reports a new tier', () => {
    const current = clone('bca-sq-krisflyer-visa-infinite');
    current.terms[1]!.cycleBonuses[0]!.tiers.push({ minSpendMinor: 100000000, bonus: 5000 });
    expect(diffCatalogEntries(clone('bca-sq-krisflyer-visa-infinite'), current)).toEqual([
      'Monthly spend bonus (from 2025-09-23): new tier 5.000 miles from Rp 100.000.000 spent.',
    ]);
  });

  it('reports a fee change', () => {
    const current = clone('bca-sq-krisflyer-visa-signature');
    current.fees[0]!.annualFeeMinor = 600000;
    expect(diffCatalogEntries(clone('bca-sq-krisflyer-visa-signature'), current)).toEqual([
      'Annual fee: Rp 500.000, supplementary Rp 300.000 → Rp 600.000, supplementary Rp 300.000.',
    ]);
  });

  it('reports a new terms period and the end of the previous one', () => {
    const current = clone('bca-sq-krisflyer-visa-signature');
    const previous = current.terms[1]!;
    previous.effectiveTo = '2026-09-30';
    const next = { ...structuredClone(previous), effectiveFrom: '2026-10-01', effectiveTo: null };
    next.rules[0]!.rateDen = 15000;
    current.terms.push(next);
    const lines = diffCatalogEntries(clone('bca-sq-krisflyer-visa-signature'), current);
    expect(lines).toContain('Base (from 2025-09-23): now ends 2026-09-30.');
    expect(lines).toContain('Monthly spend bonus (from 2025-09-23): now ends 2026-09-30.');
    expect(lines.some((line) => /^New rule Base \(from 2026-10-01\): 1 mile per Rp 15\.000/.test(line))).toBe(true);
    expect(lines.some((line) => line.startsWith('New bonus Monthly spend bonus (from 2026-10-01)'))).toBe(true);
  });

  it('reports narrowing a rule to categories, a partner ratio, and cash value', () => {
    const current = clone('bca-unionpay');
    current.terms[0]!.rules[0]!.match.categoryKeys = ['travel'];
    current.transferPartners[0]!.points = 250;
    current.cashValue = { valueMinor: 25, perPoints: 1, currency: 'IDR' };
    const program = current.transferPartners[0]!.program;
    expect(diffCatalogEntries(clone('bca-unionpay'), current)).toEqual([
      'Base: now applies only to Travel.',
      `Transfer to ${program}: 200 = 100, in steps of 20 → 250 = 100, in steps of 20.`,
      'Cash value: Rp 20 per 1 point → Rp 25 per 1 point.',
    ]);
  });
});
