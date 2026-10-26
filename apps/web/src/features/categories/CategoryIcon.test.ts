import { BUSINESS_CATEGORIES, CATEGORY_ICONS, TRANSFER_VISUAL, UNKNOWN_VISUAL } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { ICONS } from './CategoryIcon';

describe('category icons', () => {
  it('draws every icon the category data names', () => {
    const names = new Set([...Object.values(CATEGORY_ICONS), TRANSFER_VISUAL.icon, UNKNOWN_VISUAL.icon]);
    expect([...names].filter((name) => !ICONS[name])).toEqual([]);
  });

  it('draws every icon the business list names', () => {
    expect(BUSINESS_CATEGORIES.filter((c) => !ICONS[c.icon]).map((c) => c.icon)).toEqual([]);
  });
});
