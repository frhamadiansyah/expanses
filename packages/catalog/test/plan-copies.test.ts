import { describe, expect, it } from 'vitest';
import { findEntry, planCatalogApply } from '../src/index';

describe('a catalogue category key with a copy in every workspace', () => {
  it('puts every copy in the rule it plans, so the rule earns in each', () => {
    // OCBC 90°N is the entry whose rules name category keys outright; jenius-platinum's category choice is
    // matched by MCC, so it never carries a category id to test with.
    const entry = findEntry('ocbc-90n')!;
    const plan = planCatalogApply(entry, { food_beverage: ['c-dining-personal', 'c-dining-business'] }, '2026-09-18');
    const rule = plan.rules.find((row) => row.match.categoryIds?.includes('c-dining-personal'));
    expect(rule?.match.categoryIds).toEqual(['c-dining-personal', 'c-dining-business']);
    // A key with no category anywhere is still reported as unmapped, exactly as before.
    expect(planCatalogApply(entry, {}, '2026-09-18').unmappedKeys).toContain('food_beverage');
  });
});
