import { describe, expect, it } from 'vitest';
import { CATEGORY_ICONS, currencyInfo, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_KEYS, DEFAULT_CATEGORY_MCCS, ON_DEMAND_CATEGORY_KEYS } from '../src/index';

describe('default categories', () => {
  const allKeys = DEFAULT_CATEGORIES.flatMap((c) => [c.key, ...(c.children ?? []).map((child) => child.key)]);

  it('gives every default category and child a unique key', () => {
    expect(new Set(allKeys).size).toBe(allKeys.length);
    expect(DEFAULT_CATEGORY_KEYS.size).toBe(allKeys.length);
  });

  it('includes the keys catalogue exclusions need', () => {
    for (const key of [
      'utilities.electricity',
      'utilities.water_sanitation',
      'utilities.gas_energy',
      'government_taxes',
      'gift_giving',
      'donation.charity',
      'donation.obligation',
      'miscellaneous.fees_charges',
      'protection.health_insurance',
      'property.real_estate',
      'transportation',
      'travel',
      'business',
    ]) {
      expect(DEFAULT_CATEGORY_KEYS.has(key), key).toBe(true);
    }
  });

  it('prefixes child keys with their parent key', () => {
    for (const category of DEFAULT_CATEGORIES) {
      for (const child of category.children ?? []) expect(child.key.startsWith(`${category.key}.`), child.key).toBe(true);
    }
  });

  it('names every default, so a workspace can be matched by name where it has no key', () => {
    const names = DEFAULT_CATEGORIES.flatMap((c) => [c.name, ...(c.children ?? []).map((child) => child.name)]);
    for (const name of ['Household', 'Groceries', 'Food and beverage', 'Restaurants', 'Utilities', 'Electricity', 'Water & sanitation', 'Donation', 'Charity', 'Miscellaneous', 'Membership fee', 'Salary', 'Other Income']) {
      expect(names, name).toContain(name);
    }
    expect(new Set(names).size, 'names are unique, so a match is never ambiguous').toBe(names.length);
  });

  it('offers Top-ups under Miscellaneous like any other child, with its MCC and an icon of its own', () => {
    const miscellaneous = DEFAULT_CATEGORIES.find((category) => category.key === 'miscellaneous')!;
    expect(miscellaneous.kind).toBe('expense');
    expect(miscellaneous.children!.filter((child) => child.key === 'miscellaneous.top_ups')).toEqual([{ key: 'miscellaneous.top_ups', name: 'Top-ups' }]);
    expect(DEFAULT_CATEGORY_KEYS.has('miscellaneous.top_ups')).toBe(true);
    expect(DEFAULT_CATEGORY_MCCS['miscellaneous.top_ups']).toBe('5999');
    expect(CATEGORY_ICONS['miscellaneous.top_ups']).toBe('wallet-cards');
  });

  it('keeps only Refunds made on first need, and never a key that is also a default', () => {
    expect([...ON_DEMAND_CATEGORY_KEYS]).toEqual(['miscellaneous.refunds']);
    for (const key of ON_DEMAND_CATEGORY_KEYS) expect(DEFAULT_CATEGORY_KEYS.has(key), key).toBe(false);
  });
});

describe('currencies', () => {
  it('supports TWD with exponent 2', () => {
    expect(currencyInfo('TWD').exponent).toBe(2);
  });
});

describe('addendum categories', () => {
  it('keeps real estate and business, which card rules name', () => {
    expect(DEFAULT_CATEGORY_KEYS.has('property.real_estate')).toBe(true);
    expect(DEFAULT_CATEGORY_KEYS.has('business')).toBe(true);
    const property = DEFAULT_CATEGORIES.find((c) => c.key === 'property');
    expect(property?.children?.find((c) => c.key === 'property.real_estate')?.name).toBe('Real estate');
    expect(DEFAULT_CATEGORIES.find((c) => c.key === 'business')?.name).toBe('Business & Invoices');
  });
});

describe('MCC addendum categories', () => {
  it('files sports and fitness under personal care, where it now belongs', () => {
    const personal = DEFAULT_CATEGORIES.find((c) => c.key === 'personal_care');
    expect(personal?.children?.find((c) => c.key === 'personal_care.sports_fitness')?.name).toBe('Sports & fitness');
  });
});
