import { describe, expect, it } from 'vitest';
import { categoryDefaultMcc, DEFAULT_CATEGORY_KEYS, DEFAULT_CATEGORY_MCCS, isMcc, isMccSpec, type MccSources, mccInRange, mccName, resolveMcc } from '../src/index';

const sources = (overrides: Partial<MccSources> = {}): MccSources => ({
  typed: null,
  memory: [],
  bundled: [
    { pattern: 'mcdonald', mcc: '5814' },
    { pattern: 'starbucks', mcc: '5814' },
    { pattern: 'starbucks reserve', mcc: '5812' },
  ],
  categoryDefault: (categoryId) => (categoryId === 'dining' ? '5812' : null),
  ...overrides,
});

describe('resolveMcc', () => {
  it('uses a typed MCC before memory, bundled, and category', () => {
    expect(resolveMcc("MCDONALD'S SENAYAN", 'dining', sources({ typed: '5812', memory: [{ pattern: 'mcdonald', mcc: '5813' }] }))).toEqual({ mcc: '5812', source: 'typed' });
  });

  it('uses memory before the bundled list', () => {
    expect(resolveMcc("MCDONALD'S SENAYAN", 'dining', sources({ memory: [{ pattern: 'mcdonald', mcc: '5813' }] }))).toEqual({ mcc: '5813', source: 'memory' });
    expect(resolveMcc("MCDONALD'S SENAYAN", 'dining', sources())).toEqual({ mcc: '5814', source: 'bundled' });
  });

  it('prefers the longest matching pattern, then the earlier entry', () => {
    expect(resolveMcc('STARBUCKS RESERVE DEWATA', 'dining', sources())).toEqual({ mcc: '5812', source: 'bundled' });
    expect(resolveMcc('GRAB FOOD', 'dining', sources({ memory: [{ pattern: 'grab', mcc: '4121' }, { pattern: 'food', mcc: '5814' }] }))).toEqual({ mcc: '4121', source: 'memory' });
  });

  it('lets a memory entry without an MCC ignore the bundled pattern and fall back to the category', () => {
    expect(resolveMcc('MCDONALD SENAYAN', 'dining', sources({ memory: [{ pattern: 'mcdonald', mcc: null }] }))).toEqual({ mcc: '5812', source: 'category' });
  });

  it('returns null when no source applies', () => {
    expect(resolveMcc('WARUNG BU TINI', 'other', sources())).toEqual({ mcc: null, source: null });
  });
});

describe('MCC specs', () => {
  it('matches single codes and inclusive ranges', () => {
    expect(mccInRange('5814', '5814')).toBe(true);
    expect(mccInRange('5812', '5814')).toBe(false);
    expect(mccInRange('3000', '3000-3299')).toBe(true);
    expect(mccInRange('3299', '3000-3299')).toBe(true);
    expect(mccInRange('3300', '3000-3299')).toBe(false);
  });

  it('validates codes and ranges', () => {
    expect(isMcc('0101')).toBe(true);
    for (const bad of ['581', '58120', 'abcd', '']) expect(isMcc(bad), bad).toBe(false);
    expect(isMccSpec('5814')).toBe(true);
    expect(isMccSpec('3000-3299')).toBe(true);
    for (const bad of ['3300-3000', '3000-', '581', '3000-32999']) expect(isMccSpec(bad), bad).toBe(false);
  });

  it('names known codes', () => {
    expect(mccName('5814')).toBe('Fast Food Restaurants');
    expect(mccName('0000')).toBeNull();
  });
});

describe('category default MCC', () => {
  const categories = [
    { id: 'food', parentId: null, systemKey: 'food_beverage' },
    { id: 'dining', parentId: 'food', systemKey: 'food_beverage.restaurants' },
    { id: 'hawker', parentId: 'food', systemKey: null },
    { id: 'misc', parentId: null, systemKey: 'miscellaneous' },
  ];

  it('uses the override, then the built-in default for the key, then the parent', () => {
    expect(categoryDefaultMcc('dining', categories, {})).toBe('5812');
    expect(categoryDefaultMcc('dining', categories, { dining: '5814' })).toBe('5814');
    expect(categoryDefaultMcc('hawker', categories, {})).toBe('5812');
    expect(categoryDefaultMcc('hawker', categories, { food: '5499' })).toBe('5499');
    expect(categoryDefaultMcc('misc', categories, {})).toBeNull();
    expect(categoryDefaultMcc('unknown', categories, {})).toBeNull();
  });

  it('keys built-in defaults by default category keys with valid codes', () => {
    for (const [key, mcc] of Object.entries(DEFAULT_CATEGORY_MCCS)) {
      expect(DEFAULT_CATEGORY_KEYS.has(key), key).toBe(true);
      expect(isMcc(mcc), key).toBe(true);
    }
    expect(DEFAULT_CATEGORY_MCCS['food_beverage.cafe_dessert']).toBe('5814');
    expect(DEFAULT_CATEGORY_MCCS['personal_care.sports_fitness']).toBe('5941');
    // Both halves of the split telephone line keep the telecom code.
    expect(DEFAULT_CATEGORY_MCCS['utilities.internet_provider']).toBe('4814');
    expect(DEFAULT_CATEGORY_MCCS['utilities.mobile_phone']).toBe('4814');
    expect(DEFAULT_CATEGORY_MCCS.fees).toBeUndefined();
  });
});
