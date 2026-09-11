import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { CATALOG, feeOn, findEntry, isStale, termsOn, validateEntry } from '../src/index';

describe('bundled catalogue', () => {
  it('bundles entries with unique ids, all valid', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(6);
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    for (const entry of CATALOG) expect(validateEntry(entry, DEFAULT_CATEGORY_KEYS), entry.id).toEqual([]);
  });

  it('selects the KrisFlyer terms period with the Prudential exclusion from 2025-09-23', () => {
    const signature = findEntry('bca-sq-krisflyer-visa-signature')!;
    expect(termsOn(signature, '2025-09-22')!.rules[0]!.match.excludeMerchantPatterns).toBeUndefined();
    expect(termsOn(signature, '2025-09-23')!.rules[0]!.match.excludeMerchantPatterns).toEqual(['prudential']);
  });

  it('selects the Visa Infinite fee in force on a date', () => {
    const infinite = findEntry('bca-sq-krisflyer-visa-infinite')!;
    expect(feeOn(infinite, '2026-06-02')!.annualFeeMinor).toBe(750000);
    expect(feeOn(infinite, '2026-06-03')!.annualFeeMinor).toBe(1000000);
  });

  it('marks entries stale after 180 days', () => {
    const entry = findEntry('bca-unionpay')!;
    expect(isStale(entry, '2027-03-10')).toBe(false);
    expect(isStale(entry, '2027-03-11')).toBe(true);
  });

  it('excludes CIMB insurance premiums until 2025-12-31 only', () => {
    const cimb = findEntry('cimb-niaga-world-all-accor')!;
    expect(termsOn(cimb, '2025-12-31')!.rules[0]!.match.excludeCategoryKeys).toContain('health.insurance');
    expect(termsOn(cimb, '2026-01-01')!.rules[0]!.match.excludeCategoryKeys).not.toContain('health.insurance');
    expect(cimb.program.fixedStatementDay).toBe(22);
  });

  it('encodes the Mandiri fee condition and the Marriott milestone above Rp 30.000.000', () => {
    expect(findEntry('mandiri-world-prioritas')!.fees[0]!.condition).toMatch(/Prioritas/);
    expect(termsOn(findEntry('mandiri-marriott-bonvoy')!, '2026-09-11')!.cycleBonuses[0]!.tiers).toEqual([{ minSpendMinor: 30000001, bonus: 2500 }]);
  });
});
