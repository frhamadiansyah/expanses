import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, sortFilterCount } from './SortFilterMenu';

describe('sortFilterCount', () => {
  it('is zero at rest', () => expect(sortFilterCount({ sortValue: DEFAULT_SORT, paid: '' })).toBe(0));
  it('counts a changed sort and a paid filter', () => {
    expect(sortFilterCount({ sortValue: 'amount:desc', paid: '' })).toBe(1);
    expect(sortFilterCount({ sortValue: 'date:asc', paid: 'acct:1' })).toBe(2);
    expect(sortFilterCount({ sortValue: DEFAULT_SORT, paid: 'card:2' })).toBe(1);
  });
});
