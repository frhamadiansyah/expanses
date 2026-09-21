import { isoDate } from '@expanses/core';
import { type AccountRow, categoryIdsOfBook, listAccounts, nativeBalances, pocketParentIds, resolveRates } from '@expanses/db';
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
  return useCallback(() => queryClient.invalidateQueries(), [queryClient]);
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
