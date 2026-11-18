import type { AccountRow } from '@expanses/db';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { isMoneyAccount, moneyHolders, refreshAfterWrite } from './queries';

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

describe('a write while a list is still loading', () => {
  /** A list whose first read starts before the write and answers after it, with what it saw when it started; then the refresh. */
  async function listAfterWrite(refresh: (client: QueryClient) => Promise<void>) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const goals: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const queryFn = async () => {
      const seen = [...goals];
      reads++;
      if (reads === 1) await gate;
      return seen;
    };
    const unsubscribe = new QueryObserver(client, { queryKey: ['goal-plans'], queryFn }).subscribe(() => undefined);
    await Promise.resolve();
    goals.push('Hajj');
    const refreshed = refresh(client);
    release();
    await refreshed;
    unsubscribe();
    return client.getQueryData(['goal-plans']);
  }

  it('is in the list afterwards: the first fetch begun before the write is cancelled and read again', async () => {
    expect(await listAfterWrite(refreshAfterWrite)).toEqual(['Hajj']);
    // A plain invalidate joins the fetch begun before the write and keeps its answer: the race this guards against.
    expect(await listAfterWrite((client) => client.invalidateQueries())).toEqual([]);
  });
});
