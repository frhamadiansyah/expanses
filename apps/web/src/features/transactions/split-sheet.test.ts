import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { otherWorkspaces, workspaceChoices } from './SplitSheet';

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
  const named = (offered: ReturnType<typeof otherWorkspaces>) => offered.map((other) => [other.book.name, other.options.map((option) => option.label)]);

  it('offers each other workspace’s spending categories, a child under its parent’s name, a shared one included', () => {
    expect(named(otherWorkspaces(accounts, books, 'family', filed, {}, new Set(['home'])))).toEqual([
      ['Business', ['Office', 'Office › Paper']],
      ['Home', ['Food']],
    ]);
  });

  it('offers only workspaces that are not shared from a shared one: a split has a part in one shared workspace at most', () => {
    expect(named(otherWorkspaces(accounts, books, 'home', filed, {}, new Set(['home'])))).toEqual([
      ['Family', ['Groceries']],
      ['Business', ['Office', 'Office › Paper']],
    ]);
    expect(named(otherWorkspaces(accounts, books, 'home', filed, {}, new Set(['home', 'business'])))).toEqual([['Family', ['Groceries']]]);
  });

  it('offers none from a workspace kept read-only, never one, and none with no workspace open', () => {
    expect(otherWorkspaces(accounts, books, 'home', filed, {}, new Set(['home']), new Set(['home']))).toEqual([]);
    expect(named(otherWorkspaces(accounts, books, 'family', filed, {}, new Set(['home']), new Set(['home'])))).toEqual([['Business', ['Office', 'Office › Paper']]]);
    expect(otherWorkspaces(accounts, books, undefined, filed, {}, new Set())).toEqual([]);
  });
});

describe('the workspaces a part’s chooser lists', () => {
  const open = books[0]!;
  const others = otherWorkspaces(accounts, books, 'family', filed, {}, new Set(['home']));
  const names = (list: ReturnType<typeof workspaceChoices>) => list.map((choice) => choice.name);

  it('lists the open workspace first, the others after, and No workspace last', () => {
    expect(names(workspaceChoices(open, others, true))).toEqual(['Family', 'Business', 'Home', 'No workspace']);
  });

  it('leaves No workspace out where Not counted is not offered, unless the part already is it', () => {
    expect(names(workspaceChoices(open, others, false))).toEqual(['Family', 'Business', 'Home']);
    expect(names(workspaceChoices(open, others, false, true))).toContain('No workspace');
  });

  it('follows otherWorkspaces’ refusals: from a shared workspace no other shared one is listed', () => {
    const fromHome = otherWorkspaces(accounts, books, 'home', filed, {}, new Set(['home']));
    expect(names(workspaceChoices(books[2]!, fromHome, false))).toEqual(['Home', 'Family', 'Business']);
    const bothShared = otherWorkspaces(accounts, books, 'home', filed, {}, new Set(['home', 'business']));
    expect(names(workspaceChoices(books[2]!, bothShared, false))).toEqual(['Home', 'Family']);
  });

  it('is only the open workspace when there is nowhere else', () => {
    expect(workspaceChoices(open, [], false)).toHaveLength(1);
  });
});
