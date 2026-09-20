import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { categoryGroups, offeredCategories } from './offered';

const category = (id: string, name: string, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind: 'expense', subtype: 'category', name, icon: null, currency: null,
  valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const food = category('food', 'Food and beverage');
const groceries = category('groceries', 'Groceries', { parentId: 'food' });
const restaurants = category('restaurants', 'Restaurants', { parentId: 'food' });
const fuel = category('fuel', 'Fuel');
const salary = category('salary', 'Salary', { kind: 'income' });
const tree = [food, groceries, restaurants, fuel, salary];

const all = () => true;
const flat = (accounts: readonly AccountRow[], membership: Record<string, unknown> = {}, keep: (a: AccountRow) => boolean = all) =>
  categoryGroups(offeredCategories(accounts, 'expense', membership, keep)).flatMap((g) => [g.root, ...g.children]).map((a) => a.id);

describe('which categories a picker may offer', () => {
  it('keeps this kind, in this book, and leaves the other kind out', () => {
    expect(offeredCategories(tree, 'expense', {}, all).map((a) => a.id)).toEqual(['food', 'groceries', 'restaurants', 'fuel']);
    expect(offeredCategories(tree, 'income', {}, all).map((a) => a.id)).toEqual(['salary']);
    expect(offeredCategories(tree, 'expense', {}, (a) => a.id !== 'fuel').map((a) => a.id)).toEqual(['food', 'groceries', 'restaurants']);
  });

  it('leaves out what is archived, and what belongs to a category set', () => {
    expect(offeredCategories([fuel, { ...fuel, id: 'old', archivedAt: '2026-01-01T00:00:00Z' }], 'expense', {}, all).map((a) => a.id)).toEqual(['fuel']);
    expect(offeredCategories(tree, 'expense', { fuel: 'holiday' }, all).map((a) => a.id)).toEqual(['food', 'groceries', 'restaurants']);
  });
});

describe('the order a tree reads in', () => {
  it('puts each root before what hangs off it', () => {
    expect(flat(tree)).toEqual(['food', 'groceries', 'restaurants', 'fuel']);
  });

  /*
   * The bug this file exists for. A parent in a category set, or archived, used to take every child with it:
   * the child passed the filter, but the grouping only ever reached it through a parent that was no longer
   * there. A category nothing is wrong with must not disappear because of the one above it.
   */
  it('still offers a child whose parent is in a category set', () => {
    expect(flat(tree, { food: 'holiday' })).toEqual(['groceries', 'restaurants', 'fuel']);
  });

  it('still offers a child whose parent is archived', () => {
    expect(flat([{ ...food, archivedAt: '2026-01-01T00:00:00Z' }, groceries, restaurants, fuel])).toEqual(['groceries', 'restaurants', 'fuel']);
  });

  it('offers every category it was given exactly once', () => {
    const ids = flat(tree, { food: 'holiday' });
    expect(new Set(ids).size).toBe(ids.length);
  });
});
