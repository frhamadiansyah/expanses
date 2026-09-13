import { describe, expect, it } from 'vitest';
import { categoryMcc } from './category-mcc';

const categories = [
  { id: 'food', parentId: null, systemKey: 'food_beverage' },
  { id: 'dining', parentId: 'food', systemKey: 'food_beverage.restaurants' },
  { id: 'hawker', parentId: 'food', systemKey: null },
  { id: 'misc', parentId: null, systemKey: 'miscellaneous' },
];

describe('categoryMcc', () => {
  it('reports the effective MCC and whether it is yours, the default, or inherited', () => {
    expect(categoryMcc(categories[1]!, categories, {})).toEqual({ mcc: '5812', source: 'default' });
    expect(categoryMcc(categories[1]!, categories, { dining: '5813' })).toEqual({ mcc: '5813', source: 'yours' });
    expect(categoryMcc(categories[2]!, categories, {})).toEqual({ mcc: '5812', source: 'parent' });
    expect(categoryMcc(categories[3]!, categories, {})).toEqual({ mcc: null, source: null });
  });
});
