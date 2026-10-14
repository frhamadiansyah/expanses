import { CATEGORY_COLOURS } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { categoryMark } from './CategoryIcon';

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

describe("Travel's Transport, Souvenirs and Others", () => {
  const accounts = [
    row('travel', null, 'travel'),
    row('transport', 'travel', 'travel.transport'),
    row('souvenirs', 'travel', 'travel.souvenirs'),
    row('others', 'travel', 'travel.others'),
  ];

  it("draw a glyph of their own in Travel's colour, as Flights, Hotels and Activities do", () => {
    expect(categoryMark('transport', accounts)).toMatchObject({ colour: CATEGORY_COLOURS.travel });
    expect(categoryMark('transport', accounts).Glyph.displayName).toBe('TrainFront');
    expect(categoryMark('souvenirs', accounts).Glyph.displayName).toBe('ShoppingBag');
    expect(categoryMark('others', accounts).Glyph.displayName).toBe('Luggage');
    expect(categoryMark('others', accounts, { travel: '#16a34a' }).colour).toBe('#16a34a');
  });
});
