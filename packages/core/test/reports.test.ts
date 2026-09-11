import { describe, expect, it } from 'vitest';
import { addMonths, categoryAncestors, categoryPath, categoryTree, lastNMonths, monthRange } from '../src/index';

describe('periods', () => {
  it('computes month ranges including leap February', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('adds months across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(lastNMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

const categories = [
  { id: 'food', parentId: null, name: 'Food & Drink' },
  { id: 'groceries', parentId: 'food', name: 'Groceries' },
  { id: 'dining', parentId: 'food', name: 'Dining Out' },
  { id: 'transport', parentId: null, name: 'Transport' },
  { id: 'fuel', parentId: 'transport', name: 'Fuel' },
  { id: 'gifts', parentId: null, name: 'Gifts' },
];

describe('categoryTree', () => {
  it('rolls children into parents, prunes zeros, sorts by total', () => {
    const tree = categoryTree(categories, [
      { accountId: 'groceries', amountBaseMinor: 500_000 },
      { accountId: 'dining', amountBaseMinor: 250_000 },
      { accountId: 'dining', amountBaseMinor: 50_000 },
      { accountId: 'fuel', amountBaseMinor: 900_000 },
      { accountId: 'food', amountBaseMinor: 10_000 },
    ]);
    expect(tree.map((n) => [n.id, n.totalMinor])).toEqual([
      ['transport', 900_000],
      ['food', 810_000],
    ]);
    const food = tree[1]!;
    expect(food.ownMinor).toBe(10_000);
    expect(food.children.map((c) => [c.id, c.totalMinor])).toEqual([
      ['groceries', 500_000],
      ['dining', 300_000],
    ]);
  });

  it('builds ancestors and display paths', () => {
    expect(categoryAncestors(categories)).toMatchObject({ groceries: ['food'], food: [] });
    expect(categoryPath(categories, 'groceries')).toBe('Food & Drink › Groceries');
  });
});
