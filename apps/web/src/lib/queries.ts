import { isoDate } from '@expanses/core';
import { type AccountRow, listAccounts, nativeBalances, resolveRates } from '@expanses/db';
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
  bank: 'Bank account',
  cash: 'Cash',
  savings: 'Savings',
  investment: 'Investment',
  property: 'Property',
  vehicle: 'Vehicle',
  receivable: 'Money owed to me',
  credit_card: 'Credit card',
  loan: 'Loan',
  payable: 'Money I owe',
};
