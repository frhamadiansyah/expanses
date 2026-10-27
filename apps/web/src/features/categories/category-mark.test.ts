import { CATEGORY_COLOURS } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { shade, ringSlices } from '../transactions/category-colours';
import { categoryMark, categoryMarkColour } from './CategoryIcon';

const row = (id: string, parentId: string | null, systemKey: string | null, icon: string | null = null) =>
  ({ id, parentId, systemKey, icon, name: id, kind: 'expense', subtype: 'category', archivedAt: null }) as AccountRow;

describe('categoryMark colour', () => {
  const accounts = [row('food', null, 'food_beverage'), row('resto', 'food', 'food_beverage.restaurants'), row('mine', null, null, 'coffee')];

  it('draws the base colour until one is picked, then the picked one on the category and its subcategories', () => {
    expect(categoryMark('resto', accounts).colour).toBe(CATEGORY_COLOURS.food_beverage);
    expect(categoryMark('food', accounts, { food: '#7c3aed' }).colour).toBe('#7c3aed');
    expect(categoryMark('resto', accounts, { food: '#7c3aed' }).colour).toBe('#7c3aed');
  });

  it('colours a category of your own too, and keeps its own icon', () => {
    const mark = categoryMark('mine', accounts, { mine: '#16a34a' });
    expect(mark.colour).toBe('#16a34a');
    expect(mark.Glyph.displayName).toBe('Coffee');
  });
});

describe("Travel's Transport, Souvenirs, Meals and Others", () => {
  const accounts = [
    row('travel', null, 'travel'),
    row('transport', 'travel', 'travel.transport'),
    row('souvenirs', 'travel', 'travel.souvenirs'),
    row('meals', 'travel', 'travel.meals'),
    row('others', 'travel', 'travel.others'),
  ];

  it("draw a glyph of their own in Travel's colour, as Flights, Hotels and Activities do", () => {
    expect(categoryMark('transport', accounts)).toMatchObject({ colour: CATEGORY_COLOURS.travel });
    expect(categoryMark('transport', accounts).Glyph.displayName).toBe('TrainFront');
    expect(categoryMark('souvenirs', accounts).Glyph.displayName).toBe('ShoppingBag');
    expect(categoryMark('meals', accounts).Glyph.displayName).toBe('Utensils');
    expect(categoryMark('others', accounts).Glyph.displayName).toBe('Luggage');
    expect(categoryMark('others', accounts, { travel: '#16a34a' }).colour).toBe('#16a34a');
  });
});

describe('a chart draws a category in its mark colour', () => {
  const accounts = [row('food', null, 'food_beverage'), row('resto', 'food', 'food_beverage.restaurants'), row('mine', null, null), row('rent', null, 'utilities')];

  it('gives a ring slice the colour of the category mark, default and picked', () => {
    const items = [{ id: 'food', totalMinor: 500 }, { id: 'rent', totalMinor: 400 }, { id: 'mine', totalMinor: 300 }];
    for (const chosen of [undefined, { food: '#7c3aed', mine: '#16a34a' }]) {
      const { shown } = ringSlices(items, 8, (id) => categoryMarkColour(id, accounts, chosen));
      for (const slice of shown) expect(slice.colour).toBe(categoryMark(slice.item.id, accounts, chosen).colour);
    }
    expect(categoryMarkColour('food', accounts)).toBe(CATEGORY_COLOURS.food_beverage);
    expect(categoryMarkColour('food', accounts, { food: '#7c3aed' })).toBe('#7c3aed');
  });

  it('shades a subcategory slice of its parent mark colour, and keeps slate for none', () => {
    const parent = categoryMarkColour('food', accounts);
    expect(shade(parent, 0, 3)).toBe(shade(categoryMark('food', accounts).colour, 0, 3));
    expect(shade(parent, 1, 3)).toMatch(/^rgb\(/);
    expect(categoryMarkColour('none', accounts)).toBe('#64748b');
    expect(categoryMarkColour(null, accounts)).toBe('#64748b');
  });
});
