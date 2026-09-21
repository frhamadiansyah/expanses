import { describe, expect, it } from 'vitest';
import { needOf, resolveNeeds } from '../src/index';

const nodes = [
  { id: 'food', parentId: null },
  { id: 'restaurants', parentId: 'food' },
  { id: 'school_catering', parentId: 'food' },
  { id: 'household', parentId: null },
  { id: 'groceries', parentId: 'household' },
];

describe('a category’s need', () => {
  it('is essential, from nowhere, when nothing is marked', () => {
    expect(needOf('restaurants', nodes, {})).toEqual({ need: 'essential', source: null });
  });

  it('comes from the nearest marked ancestor', () => {
    expect(needOf('restaurants', nodes, { food: 'lifestyle' })).toEqual({ need: 'lifestyle', source: 'parent' });
  });

  it('is the category’s own when it has one, whatever the parent says', () => {
    const marks = { food: 'lifestyle', school_catering: 'essential' } as const;
    expect(needOf('school_catering', nodes, marks)).toEqual({ need: 'essential', source: 'yours' });
    expect(needOf('food', nodes, marks)).toEqual({ need: 'lifestyle', source: 'yours' });
  });

  it('resolves every node at once', () => {
    expect(resolveNeeds(nodes, { food: 'lifestyle', school_catering: 'essential' })).toEqual({
      food: 'lifestyle',
      restaurants: 'lifestyle',
      school_catering: 'essential',
      household: 'essential',
      groceries: 'essential',
    });
  });

  it('stops on a cycle rather than looping', () => {
    const loop = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(needOf('a', loop, {})).toEqual({ need: 'essential', source: null });
  });
});
