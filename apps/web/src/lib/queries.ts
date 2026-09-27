import { isoDate } from '@expanses/core';
import { type AccountRow, categoryIdsOfBook, isBookShared, listAccounts, nativeBalances, pocketParentIds, resolveRates } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApp } from '../app/context';
import { frankfurterFetcher } from './fx-client';

const fetcher = frankfurterFetcher();

export function useAccounts() {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['accounts', ws.workspaceId],
    queryFn: () => listAccounts(database, ws, { includeArchived: true }),
  });
}

/**
 * The accounts a form editing `tx` reads: every account `useAccounts` lists, plus a placeholder account the transaction
 * is already posted against (household sharing spec §4.4, §7.4). Correcting a purchase another member paid for keeps
 * them as its payer, so the form must be able to read the account it names — while every picker still offers no
 * placeholder to choose, since the pickers only keep an account already chosen. Without `tx`, `useAccounts` itself.
 */
export function useAccountsFor(tx: { id: string; entries: readonly { accountId: string }[] } | null | undefined) {
  const { database, ws } = useApp();
  const ids = tx ? [...new Set(tx.entries.map((entry) => entry.accountId))].sort() : [];
  return useQuery({
    // Without `tx` it is `useAccounts`'s own query, key and all, so a new form reads the very cache an add just
    // refreshed (a Paid with Add row returns to the form with the new account, which a key of its own may not hold yet).
    queryKey: tx ? ['accounts', ws.workspaceId, 'for', tx.id, ids.join(',')] : ['accounts', ws.workspaceId],
    queryFn: async () => {
      const listed = await listAccounts(database, ws, { includeArchived: true });
      if (!tx) return listed;
      const known = new Set(listed.map((account) => account.id));
      const wanted = new Set(ids.filter((id) => !known.has(id)));
      if (wanted.size === 0) return listed;
      const all = await listAccounts(database, ws, { includeArchived: true, includePlaceholders: true });
      return [...listed, ...all.filter((account) => wanted.has(account.id))];
    },
  });
}

/**
 * Whether the open book is shared right now (spec §4.4 last line): the add form draws the currency flag disabled and
 * offers no With row while this is true. `false` (never `undefined`) with no book open, so a personal workspace's
 * form never briefly hides its own With row while the query is in flight.
 */
export function useIsBookShared(): boolean {
  const { database, ws } = useApp();
  const { data } = useQuery({
    queryKey: ['book-shared', ws.bookId],
    queryFn: () => isBookShared(database, ws.bookId!),
    enabled: ws.bookId !== undefined,
  });
  return data ?? false;
}

/** The categories filed in the open book. Disabled when no book is open, which reads the whole workspace. */
export function useBookCategoryIds() {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['book-categories', ws.workspaceId, ws.bookId],
    queryFn: async () => new Set(await categoryIdsOfBook(database, ws.bookId!)),
    enabled: ws.bookId !== undefined,
  });
}

/**
 * A test for "this category is in the open book", for the screens that speak for one book. Only income and expense
 * lists go through it — money accounts are shared by every book. Until the ids arrive (or with no book open) every
 * category passes, so a picker is never briefly empty.
 */
export function useInOpenBook(): (a: AccountRow) => boolean {
  const ids = useBookCategoryIds().data;
  return useCallback((a: AccountRow) => !ids || ids.has(a.id), [ids]);
}

export function useBalances(asOf?: string) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['balances', ws.workspaceId, asOf ?? 'all'],
    queryFn: () => nativeBalances(database, ws, asOf),
  });
}

export function useInvalidateAll() {
  const queryClient = useQueryClient();
  const { sync } = useApp();
  // Every write in the app ends here, so this is also where a shared book hears that it has something to send.
  return useCallback(() => {
    sync.nudge();
    return queryClient.invalidateQueries();
  }, [queryClient, sync]);
}

export function useResolveRates() {
  const { database, ws } = useApp();
  return useCallback(
    (currencies: string[], onDate: string) =>
      resolveRates(database, { currencies, baseCurrency: ws.baseCurrency, onDate, today: isoDate(), fetcher }),
    [database, ws],
  );
}

/**
 * The same resolver with **no fetcher**: it reads the rates this device already stored and writes nothing.
 *
 * `useResolveRates` reaches the network and `upsertRate`s what it finds, which is right when the user has just
 * pressed Save and is asking for a figure to be converted. It is not right for a screen merely opening: this is
 * a local-first app, and choosing CNY in a picker must not be a request to a rate server, nor a write, before
 * anything has been saved. What is known locally is offered as an estimate; what is not is reported as missing,
 * which is what puts the manual exchange-rate row on the form (§3.3).
 */
export function useStoredRates() {
  const { database, ws } = useApp();
  return useCallback(
    (currencies: string[], onDate: string) => resolveRates(database, { currencies, baseCurrency: ws.baseCurrency, onDate, today: isoDate() }),
    [database, ws],
  );
}

export const isActive = (a: AccountRow) => a.archivedAt === null;
export const isMoneyAccount = (a: AccountRow) => (a.kind === 'asset' || a.kind === 'liability') && isActive(a);

/**
 * Every money account that can hold money: `isMoneyAccount` minus pocket parents, which only add their pockets up.
 * Every picker of money is built from this. `isMoneyAccount` itself stays as it is — `TransactionsPage` asks it
 * whether an account's history is owner-wide, and a parent's is.
 */
export function moneyHolders(accounts: readonly AccountRow[]): AccountRow[] {
  const parents = pocketParentIds(accounts);
  return accounts.filter((a) => isMoneyAccount(a) && !parents.has(a.id));
}

export const isCategoryOf = (kind: 'expense' | 'income') => (a: AccountRow) => a.kind === kind && isActive(a);

export { SUBTYPE_LABELS } from './account-types';
