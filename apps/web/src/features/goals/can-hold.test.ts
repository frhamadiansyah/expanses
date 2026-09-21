import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { canHoldOf } from './queries';

const rows = [
  { id: 'valas', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null },
  { id: 'usd', parentId: 'valas', kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null },
  { id: 'jenius', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null },
  { id: 'card', parentId: null, kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null },
  { id: 'gold', parentId: null, kind: 'asset', subtype: 'investment', currency: 'IDR', archivedAt: null },
] as AccountRow[];

describe('who a promise can move to (useCanHold, ruling I5)', () => {
  it('never a pocket parent: it holds no money of its own, so "Move the promise" is not offered', () => {
    expect(canHoldOf(rows, [], 'valas')).toBe(false);
    expect(canHoldOf(rows, [], 'usd')).toBe(true);
    expect(canHoldOf(rows, [], 'jenius')).toBe(true);
  });

  it('keeps the server rule otherwise: no card, and a holding only when grouped as an investment', () => {
    expect(canHoldOf(rows, [], 'card')).toBe(false);
    expect(canHoldOf(rows, [], 'gold')).toBe(false);
    expect(canHoldOf(rows, [{ accountId: 'gold', planGroup: 'invest' }], 'gold')).toBe(true);
  });
});
