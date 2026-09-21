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
] as AccountRow[];

describe('who can hold money', () => {
  it('is every money account except a pocket parent', () => {
    expect(moneyHolders(rows).map((a) => a.id)).toEqual(['usd', 'sgd', 'mandiri', 'card']);
  });

  it('leaves isMoneyAccount as it was: a parent’s history is still owner-wide', () => {
    expect(isMoneyAccount(rows[0]!)).toBe(true);
  });
});
