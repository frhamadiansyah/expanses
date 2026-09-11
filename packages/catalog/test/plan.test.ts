import { DEFAULT_CATEGORY_KEYS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { findEntry } from '../src/index';
import { planCatalogApply } from '../src/plan';

const idsExcept = (...missing: string[]) =>
  Object.fromEntries([...DEFAULT_CATEGORY_KEYS].filter((key) => !missing.includes(key)).map((key) => [key, `id:${key}`]));
const entry = (id: string) => findEntry(id)!;

describe('planCatalogApply', () => {
  it('expands the Signature terms periods into dated base rules and bonuses', () => {
    const plan = planCatalogApply(entry('bca-sq-krisflyer-visa-signature'), idsExcept(), '2026-09-11');
    expect(plan.rules.map((r) => [r.catalogKey, r.validFrom, r.validTo, r.rateNum, r.rateDen])).toEqual([
      ['2024-08-12:base', '2024-08-12', '2025-09-22', 1, 13500],
      ['2025-09-23:base', '2025-09-23', null, 1, 13500],
    ]);
    expect(plan.rules[1]!.match.excludeMerchantPatterns).toEqual(['prudential']);
    expect(plan.rules[1]!).toMatchObject({ capSpendMinor: null, capPoints: null, minTransactionMinor: null, stackable: false });
    expect(plan.bonuses.map((b) => [b.catalogKey, b.key, b.validFrom, b.validTo, b.tiers])).toEqual([
      ['2024-08-12:monthly-spend', 'monthly-spend', '2024-08-12', '2025-09-22', [{ minSpendMinor: 20000000, bonus: 1000 }]],
      ['2025-09-23:monthly-spend', 'monthly-spend', '2025-09-23', null, [{ minSpendMinor: 20000000, bonus: 1000 }]],
    ]);
    expect(plan.unmappedKeys).toEqual([]);
  });

  it('maps category keys to account ids and reports unmapped keys', () => {
    const plan = planCatalogApply(entry('bca-sq-krisflyer-visa-signature'), idsExcept('government', 'fees'), '2026-09-11');
    expect(plan.rules[0]!.match.excludeCategoryIds).toEqual(['id:utilities.electricity', 'id:utilities.water', 'id:utilities.gas', 'id:gifts_donations.donations']);
    expect(plan.unmappedKeys).toEqual(['fees', 'government']);
  });

  it('leaves out a rule whose only category keys are unmapped instead of widening it to every category', () => {
    const none = planCatalogApply(entry('mandiri-world-prioritas'), idsExcept('transport', 'housing.real_estate', 'education'), '2026-09-11');
    expect(none.rules.map((r) => r.catalogKey)).toEqual(['start:reduced-qris', 'start:reduced-insurance', 'start:foreign', 'start:domestic']);
    expect(none.unmappedKeys).toEqual(['education', 'housing.real_estate', 'transport']);
    const some = planCatalogApply(entry('mandiri-world-prioritas'), idsExcept('education'), '2026-09-11');
    expect(some.rules[0]!.match.categoryIds).toEqual(['id:transport', 'id:housing.real_estate']);
  });

  it('includes the UnionPay double-points rule, four partners, and cash value', () => {
    const plan = planCatalogApply(entry('bca-unionpay'), idsExcept(), '2026-09-11');
    expect(plan.rules.find((r) => r.stackable)!.match.currencies).toEqual(['SGD', 'HKD', 'CNY', 'TWD']);
    expect(plan.transferPartners).toHaveLength(4);
    for (const partner of plan.transferPartners) expect(partner.catalogKey).toBe(partner.key);
    expect(plan.transferPartners.find((p) => p.validFrom === '2025-11-01')!.program).toMatch(/Garuda/);
    expect(plan.cashValue).toEqual({ valueMinor: 20, perPoints: 1, currency: 'IDR' });
    expect(plan.program.unit).toBe('points');
  });

  it('carries half-point rates, origin, and keywords for CIMB', () => {
    const plan = planCatalogApply(entry('cimb-niaga-world-all-accor'), idsExcept(), '2026-09-11');
    const current = plan.rules.filter((r) => r.validFrom === '2026-01-01');
    expect(current.map((r) => [r.catalogKey, r.rateNum, r.rounding, r.priority, r.match.origin ?? null])).toEqual([
      ['2026-01-01:accor', 7.5, 'per_increment', 10, null],
      ['2026-01-01:foreign', 7.5, 'per_increment', 10, 'foreign'],
      ['2026-01-01:domestic', 2.5, 'per_increment', 0, 'domestic'],
    ]);
    expect(current[0]!.match.merchantPatterns).toContain('sofitel');
    expect(plan.program.fixedStatementDay).toBe(22);
  });

  it('uses the fee in force today', () => {
    expect(planCatalogApply(entry('bca-sq-krisflyer-visa-infinite'), idsExcept(), '2026-09-11').annualFeeMinor).toBe(1000000);
    expect(planCatalogApply(entry('bca-sq-krisflyer-visa-infinite'), idsExcept(), '2026-01-01').annualFeeMinor).toBe(750000);
    expect(planCatalogApply(entry('cimb-niaga-world-all-accor'), idsExcept(), '2026-09-11').annualFeeMinor).toBeNull();
  });
});
