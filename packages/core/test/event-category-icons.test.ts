import { describe, expect, it } from 'vitest';
import { CATEGORY_ICONS, eventCategoryIcon } from '../src/index';

describe('eventCategoryIcon', () => {
  it.each([
    ['Stay', 'bed'],
    ['Hotels', 'bed'],
    ['Food', 'utensils'],
    ['Dinner out', 'utensils'],
    ['Boats and rides', 'ship'],
    ['Transport', 'train-front'],
    ['Taxi', 'train-front'],
    ['Bike hire', 'train-front'],
    ['Flights', 'plane'],
    ['Souvenirs', 'shopping-bag'],
    ['Activities', 'map-pin'],
    ['Others', 'luggage'],
    ['Something unlisted', 'luggage'],
    ['', 'luggage'],
  ])('%s wears %s', (name, icon) => {
    expect(eventCategoryIcon(name)).toBe(icon);
  });

  it('ignores case and does not match inside a longer word', () => {
    expect(eventCategoryIcon('STAY')).toBe('bed');
    expect(eventCategoryIcon('Carpet')).toBe('luggage');
  });

  it('draws icons the Travel set itself uses, bar the boat', () => {
    const travel = new Set(Object.entries(CATEGORY_ICONS).filter(([k]) => k.startsWith('travel')).map(([, v]) => v));
    for (const name of ['Stay', 'Food', 'Transport', 'Flights', 'Souvenirs', 'Activities', 'Others']) expect(travel.has(eventCategoryIcon(name))).toBe(true);
  });
});
