import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { pickerGroups } from './CategoryPicker';

const category = (id: string, name: string, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind: 'expense', subtype: 'category', name, icon: null, currency: null,
  valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const food = category('food', 'Food and beverage');
const groceries = category('groceries', 'Groceries', { parentId: 'food' });
const restaurants = category('restaurants', 'Restaurants', { parentId: 'food' });
const boba = category('boba', 'Boba', { parentId: 'food' });
const fuel = category('fuel', 'Fuel');
const salary = category('salary', 'Salary', { kind: 'income' });
const tree = [food, groceries, restaurants, boba, fuel, salary];

const all = () => true;
/** What the sheet draws, as "root: child, child" per card — the shape, not only the names. */
const shown = (search?: string, keep: (a: AccountRow) => boolean = all, membership: Record<string, unknown> = {}) =>
  pickerGroups(tree, 'expense', membership, keep, search).map((group) => `${group.root.name}: ${group.children.map((c) => c.name).join(', ')}`);

describe('the tree the category picker draws', () => {
  it('puts each top-level category first, with what hangs off it under it', () => {
    expect(shown()).toEqual(['Food and beverage: Groceries, Restaurants, Boba', 'Fuel: ']);
  });

  it('narrows on the whole path, so a parent brings its children with it', () => {
    expect(shown('food')).toEqual(['Food and beverage: Groceries, Restaurants, Boba']);
  });

  /*
   * The narrowing happens before the grouping, which is what makes this work: matching only a child would
   * otherwise leave that child hanging off a parent the search had already thrown away, and `categoryGroups`
   * lets it stand as its own card instead. A search that finds nothing to show is the bug this catches.
   */
  it('shows a child the search matched on its own, without its parent', () => {
    expect(shown('boba')).toEqual(['Boba: ']);
  });

  it('ignores case and surrounding space, because a search box is typed into in a hurry', () => {
    expect(shown('  BOBA ')).toEqual(['Boba: ']);
  });

  it('shows nothing at all when nothing matches', () => {
    expect(shown('nasi padang')).toEqual([]);
  });

  /*
   * The workspace filter and the category-set filter are `offeredCategories`', and the picker must keep asking
   * them: a picker that stopped would offer another workspace's copy of a name nothing on screen tells apart.
   */
  it('keeps the filters it is given, searching or not', () => {
    expect(shown(undefined, (a) => a.id !== 'fuel')).toEqual(['Food and beverage: Groceries, Restaurants, Boba']);
    expect(shown('groceries', all, { groceries: 'wedding' })).toEqual([]);
  });
});
