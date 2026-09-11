import { describe, expect, it } from 'vitest';
import { searchMccs, suggestPattern } from './mcc-search';

describe('searchMccs', () => {
  it('finds codes by leading digits and names by every word', () => {
    expect(searchMccs('5814')).toEqual([{ code: '5814', name: 'Fast Food Restaurants' }]);
    expect(searchMccs('fast food')).toContainEqual({ code: '5814', name: 'Fast Food Restaurants' });
    expect(searchMccs('581').map((m) => m.code)).toEqual(expect.arrayContaining(['5811', '5812', '5813', '5814']));
    expect(searchMccs('   ')).toEqual([]);
    expect(searchMccs('restaurant', 2)).toHaveLength(2);
  });
});

describe('suggestPattern', () => {
  it('keeps the merchant words and drops store numbers and separators', () => {
    expect(suggestPattern("MCDONALD'S SENAYAN 0123")).toBe("mcdonald's senayan");
    expect(suggestPattern('GRAB*FOOD JKT 88123')).toBe('grab food jkt');
    expect(suggestPattern('  ')).toBe('');
  });
});
