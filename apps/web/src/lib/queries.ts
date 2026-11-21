import { isoDate } from '@expanses/core';
import {
  type AccountRow,
  categoryIdsOfBook,
  type Database,
  isBookShared,
  listAccounts,
  listCategoryColours,
  memberPayerAccounts,
  nativeBalances,
  pocketParentIds,
  type RateFetcher,
  type ResolvedRates,
  resolveRates,
} from '@expanses/db';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApp } from '../app/context';
import { shownAccounts } from './account-name';
import { frankfurterFetcher } from './fx-client';

const fetcher = frankfurterFetcher();

/** Every account, each `name` the one a screen shows ("Mandiri Xpresi") and `typedName` the stored one (`shownAccounts`). */
export function useAccounts() {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['accounts', ws.workspaceId],
    queryFn: async () => shownAccounts(await listAccounts(database, ws, { includeArchived: true })),
  });
}

/**
 * The accounts that stand for another household member (placeholders, spec §4.4), each by the member's name: what a bill
 * another member pays from an account of their own names on this phone, which `useAccounts` never lists.
 */
export function useMemberPayers() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['accounts', ws.workspaceId, 'member-payers'], queryFn: () => memberPayerAccounts(database, ws) });
}

/** Colours picked by hand for top-level categories, by id. Every mark and chart asks, so they agree. */
export function useCategoryColours() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-colours', ws.workspaceId], queryFn: () => listCategoryColours(database, ws) });
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
      const listed = shownAccounts(await listAccounts(database, ws, { includeArchived: true }));
      if (!tx) return listed;
      const known = new Set(listed.map((account) => account.id));
      const wanted = new Set(ids.filter((id) => !known.has(id)));
      if (wanted.size === 0) return listed;
      const all = shownAccounts(await listAccounts(database, ws, { includeArchived: true, includePlaceholders: true }));
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

export function useBalances(asOf?: string, enabled = true) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['balances', ws.workspaceId, asOf ?? 'all'],
    queryFn: () => nativeBalances(database, ws, asOf),
    enabled,
  });
}

/**
 * After a write, every read again. A read still on its first fetch is cancelled first: it may have started before the
 * write, and a refetch of a query with no data yet joins that fetch rather than starting a new one, so its answer — from
 * before the write — would be kept as fresh (a goal saved while the Goals list was still loading stayed off the list).
 * Only reads that something is waiting on are cancelled; a one-off `fetchQuery` is left to finish.
 */
export async function refreshAfterWrite(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ predicate: (query) => query.state.fetchStatus === 'fetching' && query.state.data === undefined && query.getObserversCount() > 0 });
  await queryClient.invalidateQueries();
}

export function useInvalidateAll() {
  const queryClient = useQueryClient();
  const { sync, self } = useApp();
  // Every write in the app ends here, so this is also where a shared book — and the owner's other devices — hear that
  // there is something to send.
  return useCallback(() => {
    sync.nudge();
    self?.nudge();
    return refreshAfterWrite(queryClient);
  }, [queryClient, sync, self]);
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

/** What reads a rate for a screen's figures: re-read once a rate fetched behind them is saved (`useRatesBehind`). */
export const RATE_READERS: readonly (readonly string[])[] = [['sheet-inputs'], ['net-worth-series'], ['net-worth', 'received-rates']];

/**
 * The resolver a screen's figures read rates through: the rates this device has stored, at once, and today's fetched
 * behind them.
 *
 * `useResolveRates` asks the rate server, in turn, for every currency without a rate stored for the day, and the
 * figure waits on every answer — the day's first open of Net worth waited on three round trips before it showed
 * anything, twice over (its line and its sheet each asked), and on no connection at all it waited on each failure,
 * every time it opened. Here a currency with an earlier rate is converted at that rate straight away, as a failed
 * fetch already converts it, and the day's rate is fetched once, behind the screen, and saved exactly as
 * `useResolveRates` saves it; once one is saved, the figures that read rates are read again (`RATE_READERS`), so
 * they end on the very rate `useResolveRates` would have given them. A currency with no rate stored at all is still
 * waited for, as before: there is nothing to show it at. A past day is resolved as `useResolveRates` resolves it.
 */
export function useRatesBehind() {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  return useCallback(
    (currencies: string[], onDate: string) => ratesBehind({ database, baseCurrency: ws.baseCurrency, queryClient, fetcher }, currencies, onDate),
    [database, ws, queryClient],
  );
}

/** `useRatesBehind`'s resolver, outside React. */
export async function ratesBehind(
  o: { database: Database; baseCurrency: string; queryClient: QueryClient; fetcher: RateFetcher; today?: string },
  currencies: string[],
  onDate: string,
): Promise<ResolvedRates> {
  const { database, baseCurrency, queryClient } = o;
  const today = o.today ?? isoDate();
  // Only today's rate is fetched behind the figures: a past day's (a tax year's last day) is fetched once and kept, and
  // a figure for a past day is not shown at another day's rate even for a moment.
  if (onDate < today) return resolveRates(database, { currencies, baseCurrency, onDate, today, fetcher: o.fetcher });
  const stored = await resolveRates(database, { currencies, baseCurrency, onDate, today });
  const behind = [...stored.stale, ...stored.missing].sort();
  if (behind.length === 0) return stored;
  // One fetch for every screen asking the same thing at once — the line and the sheet ask together.
  const queryKey = ['rates-behind', baseCurrency, onDate, behind.join(',')];
  const fresh = queryClient
    .fetchQuery({
      queryKey,
      staleTime: Infinity,
      queryFn: async () => {
        const answer = await resolveRates(database, { currencies: behind, baseCurrency, onDate, today, fetcher: o.fetcher });
        // A rate saved for a currency the figures were drawn at an earlier rate of: they are read again, once.
        if (stored.stale.some((currency) => answer.rates[currency] !== undefined && !answer.stale.includes(currency))) {
          for (const key of RATE_READERS) void queryClient.invalidateQueries({ queryKey: [...key] });
        }
        return answer;
      },
    })
    .then((answer) => {
      // A currency the server did not answer for is asked again the next time a screen reads it, as before.
      if (answer.stale.length > 0 || answer.missing.length > 0) queryClient.removeQueries({ queryKey, exact: true });
      return answer;
    });
  // Nothing stored to show it at: wait, exactly as `useResolveRates` does.
  if (stored.missing.length > 0) return mergeRates(stored, await fresh);
  fresh.catch((error: unknown) => console.warn('The day’s exchange rates were not fetched', error));
  return stored;
}

/** The stored rates with the fetched ones laid over them: what one `resolveRates` with a fetcher would have answered. */
function mergeRates(stored: ResolvedRates, fresh: ResolvedRates): ResolvedRates {
  const rates = { ...stored.rates, ...fresh.rates };
  const fetchedOk = (currency: string) => fresh.rates[currency] !== undefined && !fresh.stale.includes(currency);
  return {
    rates,
    stale: [...new Set([...stored.stale.filter((currency) => !fetchedOk(currency)), ...fresh.stale])].sort(),
    missing: fresh.missing,
  };
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
