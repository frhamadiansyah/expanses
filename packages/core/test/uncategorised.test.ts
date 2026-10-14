import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_KEYS, isUncategorisedKey, UNCATEGORISED } from '../src/index';

describe('Uncategorised', () => {
  it('has one key per kind, each in its kind’s key family', () => {
    expect(UNCATEGORISED.expense).toEqual({ key: 'miscellaneous.uncategorised', name: 'Uncategorised', kind: 'expense' });
    expect(UNCATEGORISED.income).toEqual({ key: 'income.uncategorised', name: 'Uncategorised', kind: 'income' });
  });

  it('is no default category: it is made on first use', () => {
    expect(DEFAULT_CATEGORY_KEYS.has(UNCATEGORISED.expense.key)).toBe(false);
    expect(DEFAULT_CATEGORY_KEYS.has(UNCATEGORISED.income.key)).toBe(false);
  });

  it('is told apart by its key alone', () => {
    expect(isUncategorisedKey('miscellaneous.uncategorised')).toBe(true);
    expect(isUncategorisedKey('income.uncategorised')).toBe(true);
    expect(isUncategorisedKey('miscellaneous.refunds')).toBe(false);
    expect(isUncategorisedKey(null)).toBe(false);
  });
});
