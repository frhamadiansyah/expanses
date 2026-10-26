import { describe, expect, it } from 'vitest';
import { BUSINESS_CATEGORIES, DEFAULT_CATEGORY_KEYS } from '../src/index';

describe('BUSINESS_CATEGORIES', () => {
  it('has unique keys and unique names within a kind, none clashing with a default key', () => {
    const keys = BUSINESS_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const kind of ['income', 'expense'] as const) {
      const names = BUSINESS_CATEGORIES.filter((c) => c.kind === kind).map((c) => c.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
    expect(keys.filter((key) => DEFAULT_CATEGORY_KEYS.has(key))).toEqual([]);
  });

  it('holds four income and fourteen expense categories, income keys under income.', () => {
    expect(BUSINESS_CATEGORIES.filter((c) => c.kind === 'income')).toHaveLength(4);
    expect(BUSINESS_CATEGORIES.filter((c) => c.kind === 'expense')).toHaveLength(14);
    for (const c of BUSINESS_CATEGORIES) expect(c.key.startsWith(c.kind === 'income' ? 'income.' : 'biz.')).toBe(true);
  });
});
