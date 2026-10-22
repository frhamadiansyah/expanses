import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { otherWorkspaces } from './SplitSheet';

const category = (id: string, name: string, extra: Partial<AccountRow> = {}): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind: 'expense', subtype: 'category', name, icon: null, currency: null,
  valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-09-01T00:00:00Z', ...extra,
});

const books = [
  { id: 'family', name: 'Family', kind: 'family' },
  { id: 'business', name: 'Business', kind: 'business' },
  { id: 'home', name: 'Home', kind: 'shared' },
];
const accounts = [
  category('groceries', 'Groceries'),
  category('office', 'Office'),
  category('paper', 'Paper', { parentId: 'office' }),
  category('old', 'Old stock', { archivedAt: '2026-09-02T00:00:00Z' }),
  category('fees', 'Fees', { kind: 'income' }),
  category('shared-food', 'Food'),
];
const filed = { groceries: 'family', office: 'business', paper: 'business', old: 'business', fees: 'business', 'shared-food': 'home' };

describe('the other workspaces a split line can be filed in', () => {
  it('offers each other workspace’s spending categories, a child under its parent’s name', () => {
    const offered = otherWorkspaces(accounts, books, 'family', filed, {}, new Set(['home']));
    expect(offered.map((other) => [other.book.name, other.options.map((option) => option.label)])).toEqual([['Business', ['Office', 'Office › Paper']]]);
  });

  it('offers none from a workspace shared with a household, nor with no workspace open', () => {
    expect(otherWorkspaces(accounts, books, 'home', filed, {}, new Set(['home']))).toEqual([]);
    expect(otherWorkspaces(accounts, books, undefined, filed, {}, new Set())).toEqual([]);
  });
});
