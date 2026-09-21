import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { isMoneyAccount, moneyHolders } from './queries';

const rows = [
  { id: 'valas', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null },
  { id: 'usd', parentId: 'valas', kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null },
  { id: 'sgd', parentId: 'valas', kind: 'asset', subtype: 'savings', currency: 'SGD', archivedAt: null },
  { id: 'mandiri', parentId: null, kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null },
  { id: 'card', parentId: null, kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null },
  { id: 'food', parentId: null, kind: 'expense', subtype: 'category', currency: null, archivedAt: null },
  { id: 'dining', parentId: 'food', kind: 'expense', subtype: 'category', currency: null, archivedAt: null },
  // Archived: never offered, whether a pocket or a plain account (P2-M1).
  { id: 'old-jpy', parentId: 'valas', kind: 'asset', subtype: 'savings', currency: 'JPY', archivedAt: '2026-01-01' },
  { id: 'closed', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: '2026-01-01' },
] as AccountRow[];

describe('who can hold money', () => {
  it('is every open money account except a pocket parent — an archived pocket or account is not offered', () => {
    expect(moneyHolders(rows).map((a) => a.id)).toEqual(['usd', 'sgd', 'mandiri', 'card']);
  });

  it('leaves isMoneyAccount as it was: a parent’s history is still owner-wide', () => {
    expect(isMoneyAccount(rows[0]!)).toBe(true);
  });
});
