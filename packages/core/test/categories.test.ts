import { describe, expect, it } from 'vitest';
import { currencyInfo, DEFAULT_CATEGORIES, DEFAULT_CATEGORY_KEYS } from '../src/index';

describe('default categories', () => {
  const allKeys = DEFAULT_CATEGORIES.flatMap((c) => [c.key, ...(c.children ?? []).map((child) => child.key)]);

  it('gives every default category and child a unique key', () => {
    expect(new Set(allKeys).size).toBe(allKeys.length);
    expect(DEFAULT_CATEGORY_KEYS.size).toBe(allKeys.length);
  });

  it('includes the keys catalogue exclusions need', () => {
    for (const key of ['utilities.electricity', 'utilities.water', 'utilities.gas', 'government', 'gifts_donations.gifts', 'gifts_donations.donations', 'fees']) {
      expect(DEFAULT_CATEGORY_KEYS.has(key), key).toBe(true);
    }
  });

  it('prefixes child keys with their parent key', () => {
    for (const category of DEFAULT_CATEGORIES) {
      for (const child of category.children ?? []) expect(child.key.startsWith(`${category.key}.`), child.key).toBe(true);
    }
  });

  it('keeps existing default names so v0 workspaces can be matched', () => {
    const names = DEFAULT_CATEGORIES.flatMap((c) => [c.name, ...(c.children ?? []).map((child) => child.name)]);
    for (const name of ['Food & Drink', 'Groceries', 'Dining Out', 'Coffee & Snacks', 'Bills & Utilities', 'Electricity', 'Water', 'Gifts & Donations', 'Fees & Charges', 'Card Annual Fee', 'Other Expense', 'Salary', 'Other Income']) {
      expect(names, name).toContain(name);
    }
  });
});

describe('currencies', () => {
  it('supports TWD with exponent 2', () => {
    expect(currencyInfo('TWD').exponent).toBe(2);
  });
});
