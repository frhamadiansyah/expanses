import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORY_NEEDS, needOf, readNeed, resolveNeeds } from '../src/index';

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

describe('the built-in marks by system key', () => {
  // A tree as the defaults seed it, with names the owner has since changed (invented).
  const tree = [
    { id: 'fb', parentId: null, systemKey: 'food_beverage' },
    { id: 'resto', parentId: 'fb', systemKey: 'food_beverage.restaurants' },
    { id: 'home-cat', parentId: 'fb', systemKey: 'food_beverage.home_catering' },
    { id: 'fb-own', parentId: 'fb', systemKey: null },
    { id: 'shop', parentId: null, systemKey: 'shopping' },
    { id: 'shop-own', parentId: 'shop', systemKey: null },
    { id: 'shop-own-deeper', parentId: 'shop-own', systemKey: null },
    { id: 'prot', parentId: null, systemKey: 'protection' },
    { id: 'life-ins', parentId: 'prot', systemKey: 'protection.life_insurance' },
    { id: 'misc', parentId: null, systemKey: 'miscellaneous' },
    { id: 'interest', parentId: 'misc', systemKey: 'miscellaneous.interest' },
    { id: 'postal', parentId: 'misc', systemKey: 'miscellaneous.postal_service' },
    { id: 'zakat', parentId: null, systemKey: 'donation' },
    { id: 'own-top', parentId: null, systemKey: null },
  ];

  it('order: own mark, then an ancestor’s mark, then the key’s default, then essential', () => {
    expect(needOf('resto', tree, {})).toEqual({ need: 'lifestyle', source: 'default' });
    expect(needOf('resto', tree, { fb: 'essential' })).toEqual({ need: 'essential', source: 'parent' });
    expect(needOf('resto', tree, { fb: 'essential', resto: 'debts_savings' })).toEqual({ need: 'debts_savings', source: 'yours' });
    expect(needOf('own-top', tree, {})).toEqual({ need: 'essential', source: null });
  });

  it('an own category under a built-in one takes the nearest ancestor key’s default', () => {
    expect(needOf('shop-own', tree, {})).toEqual({ need: 'lifestyle', source: 'default' });
    expect(needOf('shop-own-deeper', tree, {})).toEqual({ need: 'lifestyle', source: 'default' });
    // Food and beverage itself has no default: an own category under it is essential, from nowhere.
    expect(needOf('fb', tree, {})).toEqual({ need: 'essential', source: null });
    expect(needOf('fb-own', tree, {})).toEqual({ need: 'essential', source: null });
    expect(needOf('home-cat', tree, {})).toEqual({ need: 'essential', source: 'default' });
  });

  it('the owner’s mark beats a default, on the category or above it', () => {
    expect(needOf('shop', tree, { shop: 'essential' })).toEqual({ need: 'essential', source: 'yours' });
    expect(needOf('shop-own', tree, { shop: 'essential' })).toEqual({ need: 'essential', source: 'parent' });
    expect(needOf('life-ins', tree, { prot: 'lifestyle' })).toEqual({ need: 'lifestyle', source: 'parent' });
  });

  it('Debts & savings for protection, donation and loan interest; the rest of miscellaneous is essential', () => {
    expect(needOf('life-ins', tree, {}).need).toBe('debts_savings');
    expect(needOf('prot', tree, {}).need).toBe('debts_savings');
    expect(needOf('zakat', tree, {}).need).toBe('debts_savings');
    expect(needOf('interest', tree, {}).need).toBe('debts_savings');
    expect(needOf('postal', tree, {}).need).toBe('essential');
    expect(needOf('misc', tree, {}).need).toBe('essential');
  });

  it('a renamed or moved built-in category keeps its key’s default', () => {
    const moved = tree.map((node) => (node.id === 'life-ins' ? { ...node, parentId: 'own-top' } : node));
    expect(needOf('life-ins', moved, {})).toEqual({ need: 'debts_savings', source: 'default' });
  });

  it('names every built-in spending key the owner listed, children included', () => {
    expect(DEFAULT_CATEGORY_NEEDS['shopping.clothing']).toBe('lifestyle');
    expect(DEFAULT_CATEGORY_NEEDS['travel.souvenirs']).toBe('lifestyle');
    expect(DEFAULT_CATEGORY_NEEDS['gift_giving.wedding']).toBe('lifestyle');
    expect(DEFAULT_CATEGORY_NEEDS['personal_care.spa_wellness']).toBe('lifestyle');
    expect(DEFAULT_CATEGORY_NEEDS['entertainment.games']).toBe('lifestyle');
    expect(DEFAULT_CATEGORY_NEEDS['donation.charity']).toBe('debts_savings');
    expect(DEFAULT_CATEGORY_NEEDS['protection.auto_insurance']).toBe('debts_savings');
    expect(DEFAULT_CATEGORY_NEEDS['food_beverage.school_catering']).toBe('essential');
    expect(DEFAULT_CATEGORY_NEEDS['utilities.electricity']).toBe('essential');
    expect(DEFAULT_CATEGORY_NEEDS.business).toBe('essential');
    expect(DEFAULT_CATEGORY_NEEDS.food_beverage).toBeUndefined();
    // No income key ever has a mark.
    expect(Object.keys(DEFAULT_CATEGORY_NEEDS).some((key) => key.startsWith('income.'))).toBe(false);
  });

  it('reads a stored value it does not know as no mark', () => {
    expect(readNeed('debts_savings')).toBe('debts_savings');
    expect(readNeed('something_else')).toBeUndefined();
    expect(needOf('resto', tree, { resto: 'later_value' as never })).toEqual({ need: 'lifestyle', source: 'default' });
  });
});
