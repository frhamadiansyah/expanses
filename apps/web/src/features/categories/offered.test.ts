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

/*
 * Moved here from `lib/queries.test.ts`, which held the same rule for a second filter called `categoryChoices`.
 * The two had already drifted — that one had no set-membership test — so the desktop's in-place row editor
 * offered set categories `CategoryPicker` hid. There is one filter now, and its book rule is tested at it.
 */
describe('which workspace’s copy a picker may offer', () => {
  /** Two workspaces, one made by copying the other: same name, same path, twice, under different ids. */
  const copies = [
    category('mine-food', 'Food and beverage'),
    category('mine-restaurants', 'Restaurants', { parentId: 'mine-food' }),
    category('theirs-food', 'Food and beverage'),
    category('theirs-restaurants', 'Restaurants', { parentId: 'theirs-food' }),
    category('mine-salary', 'Salary', { kind: 'income' }),
    category('mine-closed', 'Cigarettes', { archivedAt: '2026-01-01T00:00:00.000Z' }),
    category('acct-bank', 'BCA Tahapan', { kind: 'asset', subtype: 'bank', currency: 'IDR' }),
  ];
  /** What `useInOpenBook` gives once `book-categories` has arrived: a test for "filed in the open workspace". */
  const openBook = (ids: readonly string[]) => (a: AccountRow) => ids.includes(a.id);

  it('offers the open workspace’s copy and never the other workspace’s', () => {
    const offered = offeredCategories(copies, 'expense', {}, openBook(['theirs-food', 'theirs-restaurants']));
    // One Restaurants, not two. Unnarrowed, this list holds two buttons with the same name *and* the same title
    // path — nothing on screen tells them apart, and picking the wrong one re-files the spending into the other
    // workspace, which is the write `replaceTransaction` refuses with OTHER_BOOK.
    expect(offered.filter((a) => a.name === 'Restaurants').map((a) => a.id)).toEqual(['theirs-restaurants']);
    expect(offered.map((a) => a.id)).toEqual(['theirs-food', 'theirs-restaurants']);
    // And the other way round, so the assertion turns on the book rather than on the order of the array.
    expect(offeredCategories(copies, 'expense', {}, openBook(['mine-food', 'mine-restaurants'])).map((a) => a.id)).toEqual(['mine-food', 'mine-restaurants']);
  });

  it('offers only the kind asked for, and nothing archived', () => {
    // An income category, a closed one and the bank account that paid are all out of an expense picker.
    expect(offeredCategories(copies, 'expense', {}, all).map((a) => a.id)).toEqual(['mine-food', 'mine-restaurants', 'theirs-food', 'theirs-restaurants']);
    expect(offeredCategories(copies, 'income', {}, all).map((a) => a.id)).toEqual(['mine-salary']);
  });

  it('offers everything while the book’s categories are still on their way', () => {
    // `useInOpenBook` passes every account until the ids arrive, so a picker is never briefly empty.
    expect(offeredCategories(copies, 'expense', {}, all)).toHaveLength(4);
  });

  it('never offers a set category, whichever book it is in', () => {
    // The divergence itself: this is the test `categoryChoices` could not have passed.
    expect(offeredCategories(copies, 'expense', { 'mine-restaurants': 'bali-trip' }, all).map((a) => a.id)).toEqual([
      'mine-food',
      'theirs-food',
      'theirs-restaurants',
    ]);
  });
});
