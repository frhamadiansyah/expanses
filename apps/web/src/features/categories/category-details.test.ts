import { describe, expect, it } from 'vitest';
import { deleteBlockedBy, mccCaption, needCaption } from './category-details';

describe('needCaption', () => {
  it('names where the mark came from', () => {
    expect(needCaption('yours', 'Food and beverage')).toBe('Set here');
    expect(needCaption('parent', 'Food and beverage')).toBe('Follows Food and beverage');
    expect(needCaption('parent', null)).toBe('Follows its parent');
    expect(needCaption(null, null)).toBeUndefined();
  });
});

describe('mccCaption', () => {
  it('says nothing when there is no code', () => {
    expect(mccCaption({ mcc: null, source: null }, null, 'Food')).toBeUndefined();
  });
  it('pairs the meaning with the source', () => {
    expect(mccCaption({ mcc: '5812', source: 'default' }, 'Restaurants', null)).toBe('Restaurants · built in');
    expect(mccCaption({ mcc: '4511', source: 'yours' }, 'Airlines', null)).toBe('Airlines · set here');
    expect(mccCaption({ mcc: '5812', source: 'parent' }, 'Restaurants', 'Food')).toBe('Restaurants · from Food');
  });
  it('stands alone when the code has no name', () => {
    expect(mccCaption({ mcc: '9999', source: 'yours' }, null, null)).toBe('Set here');
  });
});

describe('deleteBlockedBy', () => {
  it('names the subcategories to move first, and anything else that uses it', () => {
    expect(deleteBlockedBy({ builtIn: false, uses: [{ use: 'subcategories', count: 1 }] }, ['cvintaa'])).toBe('Has a subcategory: cvintaa.');
    expect(
      deleteBlockedBy({ builtIn: false, uses: [{ use: 'subcategories', count: 2 }, { use: 'transactions', count: 3 }, { use: 'budgets', count: 1 }] }, ['a', 'b']),
    ).toBe('Has 2 subcategories: a, b. Used by 3 transactions and a budget.');
  });
  it('says a built-in category comes back, and nothing for one that can go', () => {
    expect(deleteBlockedBy({ builtIn: true, uses: [] }, [])).toBe('Built in, so it would come back. Archive it instead.');
    expect(deleteBlockedBy({ builtIn: false, uses: [] }, [])).toBeUndefined();
  });
});
