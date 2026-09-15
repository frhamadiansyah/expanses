import { describe, expect, it } from 'vitest';
import { CATEGORY_COLOURS, CATEGORY_ICONS, categoryVisual, DEFAULT_CATEGORIES, UNKNOWN_VISUAL } from '../src/index';

describe('category visuals', () => {
  it('gives every default category an icon, so a new default cannot ship without one', () => {
    const keys = DEFAULT_CATEGORIES.flatMap((c) => [c.key, ...(c.children ?? []).map((child) => child.key)]);
    expect(keys.filter((key) => !CATEGORY_ICONS[key])).toEqual([]);
  });

  it('gives every top-level expense category a colour', () => {
    const roots = DEFAULT_CATEGORIES.filter((c) => c.kind === 'expense').map((c) => c.key);
    expect(roots.filter((key) => !CATEGORY_COLOURS[key])).toEqual([]);
  });

  it('colours a subcategory by its parent, and every income category alike', () => {
    expect(categoryVisual('household.groceries', 'household')).toEqual({ icon: 'shopping-basket', colour: CATEGORY_COLOURS.household });
    expect(categoryVisual('income.salary', 'income.salary').colour).toBe(CATEGORY_COLOURS.income);
  });

  it('lends a category the owner made its parent look', () => {
    expect(categoryVisual(null, 'household')).toEqual({ icon: 'house', colour: CATEGORY_COLOURS.household });
    expect(categoryVisual(null, null)).toEqual(UNKNOWN_VISUAL);
  });
});
