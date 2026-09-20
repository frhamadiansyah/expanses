import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { categoryChoices } from './queries';

/**
 * Two workspaces, one made by copying the other: the same category name and the same path, twice, under
 * different ids. This is the shape every category picker in the app has to survive.
 */
const accounts = [
  { id: 'mine-food', name: 'Food and beverage', kind: 'expense', subtype: 'category', parentId: null, currency: null, archivedAt: null },
  { id: 'mine-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', parentId: 'mine-food', currency: null, archivedAt: null },
  { id: 'theirs-food', name: 'Food and beverage', kind: 'expense', subtype: 'category', parentId: null, currency: null, archivedAt: null },
  { id: 'theirs-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', parentId: 'theirs-food', currency: null, archivedAt: null },
  { id: 'mine-salary', name: 'Salary', kind: 'income', subtype: 'category', parentId: null, currency: null, archivedAt: null },
  { id: 'mine-closed', name: 'Cigarettes', kind: 'expense', subtype: 'category', parentId: null, currency: null, archivedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', parentId: null, currency: 'IDR', archivedAt: null },
] as AccountRow[];

/** What `useInOpenBook` returns once `book-categories` has arrived: a test for "filed in the open workspace". */
const openBook = (ids: readonly string[]) => (a: AccountRow) => ids.includes(a.id);

describe('the categories a picker may offer', () => {
  it('offers the open workspace’s copy and never the other workspace’s', () => {
    const offered = categoryChoices(accounts, 'expense', openBook(['theirs-food', 'theirs-restaurants']));
    // One Restaurants, not two. Unnarrowed, this list holds two buttons with the same name *and* the same
    // title path — nothing on screen tells them apart, and picking the wrong one re-files the spending into
    // the other workspace, which is the write `replaceTransaction` refuses with OTHER_BOOK.
    expect(offered.filter((a) => a.name === 'Restaurants').map((a) => a.id)).toEqual(['theirs-restaurants']);
    expect(offered.map((a) => a.id)).toEqual(['theirs-food', 'theirs-restaurants']);
    // And the other way round, so the assertion turns on the book rather than on the order of the array.
    expect(categoryChoices(accounts, 'expense', openBook(['mine-food', 'mine-restaurants'])).map((a) => a.id)).toEqual(['mine-food', 'mine-restaurants']);
  });

  it('offers only the kind asked for, and nothing archived', () => {
    const everything = () => true;
    // An income category, a closed one and the bank account that paid are all out of an expense picker.
    expect(categoryChoices(accounts, 'expense', everything).map((a) => a.id)).toEqual(['mine-food', 'mine-restaurants', 'theirs-food', 'theirs-restaurants']);
    expect(categoryChoices(accounts, 'income', everything).map((a) => a.id)).toEqual(['mine-salary']);
  });

  it('offers everything while the book’s categories are still on their way', () => {
    // `useInOpenBook` passes every account until the ids arrive, so a picker is never briefly empty.
    expect(categoryChoices(accounts, 'expense', () => true)).toHaveLength(4);
  });
});
