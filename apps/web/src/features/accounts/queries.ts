import { isoDate } from '@expanses/core';
import { listTransactions, openingsOf, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { daysBefore } from './balance-series';
import { useStoredRates } from '../../lib/queries';

/** Rates this device already holds for a day — never fetched just because a screen opened (see `useStoredRates`). */
export function useHeldRates(currencies: readonly string[], onDate: string = isoDate()) {
  const { ws } = useApp();
  const stored = useStoredRates();
  const codes = [...new Set(currencies)].filter((code) => code && code !== ws.baseCurrency).sort();
  return useQuery({ queryKey: ['held-rates', ws.workspaceId, onDate, codes.join(',')], queryFn: () => stored(codes, onDate) });
}

export function useOpenings(accountIds: readonly string[]) {
  const { database, ws } = useApp();
  const ids = [...accountIds].sort();
  return useQuery({ queryKey: ['openings', ws.workspaceId, ids.join(',')], queryFn: () => openingsOf(database, ws, ids) });
}

/** How many rows an account's page lists under Recent; See all opens the rest in the ledger. */
export const RECENT_LIMIT = 5;

/**
 * The last few transactions touching any of these accounts — an account, or every pocket of one.
 *
 * Owner-wide, as the account's own history on Transactions is: an account is the owner's, not a workspace's, and a
 * Recent that left out what another workspace spent from it would not agree with the balance printed above it.
 */
export function useRecentTransactions(accountIds: readonly string[]) {
  const { database, ws } = useApp();
  const ids = [...accountIds].sort();
  return useQuery({
    queryKey: ['account-recent', ws.workspaceId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => listTransactions(database, ownerScope(ws), { accountIds: ids, limit: RECENT_LIMIT }),
  });
}

/** How many days an account's line walks back: the month its card reads. */
export const LINE_DAYS = 30;

/**
 * What moved in and out of each of these accounts on each of the last `LINE_DAYS` days, in each account's own
 * currency: the steps its line walks back through from today's balance. Owner-wide, as Recent is, so the line agrees
 * with the balance above it.
 */
export function useAccountFlows(accountIds: readonly string[]) {
  const { database, ws } = useApp();
  const ids = [...accountIds].sort();
  const today = isoDate();
  return useQuery({
    queryKey: ['account-line-flows', ws.workspaceId, today, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const wanted = new Set(ids);
      const rows = await listTransactions(database, ownerScope(ws), { accountIds: ids, from: daysBefore(today, LINE_DAYS), to: today });
      return rows.flatMap((row) =>
        row.entries.filter((entry) => wanted.has(entry.accountId)).map((entry) => ({ accountId: entry.accountId, on: row.occurredOn, minor: entry.amountMinor })),
      );
    },
  });
}
