import { isoDate } from '@expanses/core';
import { type AccountRow, categoryIdsOfBook, listAccounts, nativeBalances, resolveRates } from '@expanses/db';
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

export const isActive = (a: AccountRow) => a.archivedAt === null;
export const isMoneyAccount = (a: AccountRow) => (a.kind === 'asset' || a.kind === 'liability') && isActive(a);
export const isCategoryOf = (kind: 'expense' | 'income') => (a: AccountRow) => a.kind === kind && isActive(a);

export const SUBTYPE_LABELS: Record<string, string> = {
  bank: 'Current account',
  cash: 'Cash',
  savings: 'Saving account',
  investment: 'Investment',
  property: 'Property',
  vehicle: 'Vehicle',
  receivable: 'Money owed to me',
  credit_card: 'Credit card',
  loan: 'Loan',
  payable: 'Money I owe',
};
