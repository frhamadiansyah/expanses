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

  it("draws Travel's Transport, Souvenirs and Others in Travel's colour, each with a glyph of its own", () => {
    expect(categoryVisual('travel.transport', 'travel')).toEqual({ icon: 'train-front', colour: CATEGORY_COLOURS.travel });
    expect(categoryVisual('travel.souvenirs', 'travel')).toEqual({ icon: 'shopping-bag', colour: CATEGORY_COLOURS.travel });
    expect(categoryVisual('travel.meals', 'travel')).toEqual({ icon: 'utensils', colour: CATEGORY_COLOURS.travel });
    expect(categoryVisual('travel.others', 'travel')).toEqual({ icon: 'luggage', colour: CATEGORY_COLOURS.travel });
  });

  it('lends a category the owner made its parent look', () => {
    expect(categoryVisual(null, 'household')).toEqual({ icon: 'house', colour: CATEGORY_COLOURS.household });
    expect(categoryVisual(null, null)).toEqual(UNKNOWN_VISUAL);
  });

  it('draws Exchange gain and Exchange loss as the transfer they come from, gain in the income colour', () => {
    expect(categoryVisual('expense.exchange_loss', 'expense.exchange_loss')).toEqual({ icon: 'arrow-left-right', colour: '#475569' });
    expect(categoryVisual('income.exchange_gain', 'income.exchange_gain')).toEqual({ icon: 'arrow-left-right', colour: CATEGORY_COLOURS.income });
  });
});
