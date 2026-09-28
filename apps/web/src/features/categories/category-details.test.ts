import { describe, expect, it } from 'vitest';
import { mccCaption, needCaption } from './category-details';

describe('needCaption', () => {
  it('names where the mark came from', () => {
    expect(needCaption('yours', 'Food and beverage')).toBe('Marked by you');
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
    expect(mccCaption({ mcc: '4511', source: 'yours' }, 'Airlines', null)).toBe('Airlines · set by you');
    expect(mccCaption({ mcc: '5812', source: 'parent' }, 'Restaurants', 'Food')).toBe('Restaurants · from Food');
  });
  it('stands alone when the code has no name', () => {
    expect(mccCaption({ mcc: '9999', source: 'yours' }, null, null)).toBe('Set by you');
  });
});
