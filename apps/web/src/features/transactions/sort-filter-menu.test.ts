import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, MENU_REST, nextSort, SORTS, sortFilterCount, sortWord } from './SortFilterMenu';

describe('sortFilterCount', () => {
  it('is zero at rest', () => expect(sortFilterCount({ sortValue: DEFAULT_SORT, paid: '' })).toBe(0));
  it('counts a changed sort and a paid filter', () => {
    expect(sortFilterCount({ sortValue: 'amount:desc', paid: '' })).toBe(1);
    expect(sortFilterCount({ sortValue: 'date:asc', paid: 'acct:1' })).toBe(2);
    expect(sortFilterCount({ sortValue: DEFAULT_SORT, paid: 'card:2' })).toBe(1);
  });
});

describe('the Sort row (owner 2026-11-16): one row, its order a grey word, each tap the next order', () => {
  it('cycles Newest → Oldest → Largest → Smallest → Newest', () => {
    const seen = [DEFAULT_SORT];
    for (let i = 0; i < 4; i += 1) seen.push(nextSort(seen[seen.length - 1]!));
    expect(seen.map(sortWord)).toEqual(['Newest', 'Oldest', 'Largest', 'Smallest', 'Newest']);
    expect(seen).toEqual(['date:desc', 'date:asc', 'amount:desc', 'amount:asc', 'date:desc']);
  });

  it('starts from Newest when the order on record is not one of the four', () => {
    expect(nextSort('nonsense')).toBe('date:desc');
    expect(sortWord('nonsense')).toBe('Newest');
  });

  it('names the four orders as their long labels too', () => {
    expect(SORTS.map((sort) => sort.label)).toEqual(['Newest first', 'Oldest first', 'Largest first', 'Smallest first']);
  });
});

describe('Reset', () => {
  it('puts Sort back to Newest and Paid with back to All, leaving nothing for the dot', () => {
    expect(MENU_REST).toEqual({ sortValue: 'date:desc', paid: '' });
    expect(sortFilterCount(MENU_REST)).toBe(0);
  });
});
