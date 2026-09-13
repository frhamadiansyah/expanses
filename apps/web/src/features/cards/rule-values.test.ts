import { describe, expect, it } from 'vitest';
import type { RuleMatch } from '@expanses/core';
import { parseRulePoints, mergeMatch } from './rule-values';

describe('parseRulePoints', () => {
  it('accepts whole numbers and one decimal written with a comma or a dot', () => {
    expect(parseRulePoints('3')).toBe(3);
    expect(parseRulePoints('7,5')).toBe(7.5);
    expect(parseRulePoints(' 2.5 ')).toBe(2.5);
    expect(parseRulePoints('0')).toBe(0);
    expect(parseRulePoints('')).toBeNull();
  });

  it('rejects negatives, more than one decimal, and text', () => {
    for (const value of ['-1', '7,25', '1.000', 'abc', '1,5,0']) expect(() => parseRulePoints(value), value).toThrow();
  });
});

describe('mergeMatch', () => {
  const catalogue: RuleMatch = {
    excludeCategoryIds: ['cat-fees'],
    excludeMccs: ['4900', '9211'],
    excludeMerchantPatterns: ['prudential'],
    origin: 'domestic',
    currencies: ['IDR'],
    mccs: ['5812'],
  };

  it('keeps every condition the form cannot edit', () => {
    const merged = mergeMatch(catalogue, { categoryIds: [], excludeCategoryIds: [], merchantPatterns: [] });

    expect(merged).toMatchObject({
      excludeMccs: ['4900', '9211'],
      excludeMerchantPatterns: ['prudential'],
      origin: 'domestic',
      currencies: ['IDR'],
      mccs: ['5812'],
    });
  });

  it('replaces the three the form does edit', () => {
    const merged = mergeMatch(catalogue, { categoryIds: ['cat-food'], excludeCategoryIds: ['cat-utilities'], merchantPatterns: ['grab'] });

    expect(merged).toMatchObject({ categoryIds: ['cat-food'], excludeCategoryIds: ['cat-utilities'], merchantPatterns: ['grab'] });
    expect(merged.excludeMccs).toEqual(['4900', '9211']);
  });

  it('leaves an edited field out entirely when it is emptied, rather than writing an empty list', () => {
    const merged = mergeMatch(catalogue, { categoryIds: [], excludeCategoryIds: [], merchantPatterns: [] });

    expect('categoryIds' in merged).toBe(false);
    expect('merchantPatterns' in merged).toBe(false);
    // The one the catalogue set is edited by this form, so emptying it clears it.
    expect('excludeCategoryIds' in merged).toBe(false);
  });

  it('works for a bonus that had no conditions at all', () => {
    expect(mergeMatch(undefined, { categoryIds: ['cat-food'], excludeCategoryIds: [], merchantPatterns: [] })).toEqual({ categoryIds: ['cat-food'] });
  });
});
