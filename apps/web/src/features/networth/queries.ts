import { isoDate } from '@expanses/core';
import {
  householdPurchases,
  itemTransfers,
  listBooks,
  receivedItems,
  sharingDetail,
  assetValuesAt,
  netWorthSeries,
  periodFlows,
  sheetInputsAt,
  dueTemplates,
  getAssetProfile,
  getDepositAutomation,
  idleCash,
  listAssetProfiles,
  listDepositTerms,
  listDueDeposits,
  listPrices,
  listTradeTemplates,
  listTrades,
  listUndoableByHand,
  listValuations,
  monthEndValues,
  ownerScope,
  positionsFor,
  postedTradeMoney,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';
import { useActiveNetWorthGroup } from '../sharing/net-worth-queries';
import { groupItems, jointRows, type JointRows, jointStatus, type JointStatus, type ReceivedItem } from './joint-rows';

export function useAssetValues(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['asset-values', ws.workspaceId, onDate], queryFn: () => assetValuesAt(database, ws, onDate) });
}

export function useIdleCash(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['idle-cash', ws.workspaceId, onDate], queryFn: () => idleCash(database, ws, onDate) });
}

export function useAssetProfiles() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['asset-profiles', ws.workspaceId], queryFn: () => listAssetProfiles(database, ws) });
}

export function useAssetProfile(accountId: string) {
  const { database, ws } = useApp();
  /*
   * `?? null`, as `coretax/queries.ts` does and for the same reason: an account with no profile written for it yet
   * is a null answer, not a failure. TanStack Query refuses `undefined` as a result and throws its own
   * `"<hash> data is undefined"` in its place, which is what a bank account opened from the asset list used to
   * show at the top of its own page.
   */
  return useQuery({ queryKey: ['asset-profile', ws.workspaceId, accountId], queryFn: async () => (await getAssetProfile(database, ws, accountId)) ?? null });
}

/** Every time deposit's maturity and rate, so a page can say them back beside the account they belong to. */
export function useDepositTerms() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-terms', ws.workspaceId], queryFn: () => listDepositTerms(database, ws) });
}

export function useTrades(accountId?: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['trades', ws.workspaceId, accountId ?? 'all'], queryFn: () => listTrades(database, ws, { accountId }) });
}

/** What a trade being edited moved through its cash account, read off its own transaction (null: nothing to edit). */
export function usePostedTradeMoney(tradeId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['trades', ws.workspaceId, 'posted-money', tradeId],
    queryFn: () => postedTradeMoney(database, ws, tradeId!),
    enabled: tradeId !== null,
  });
}

export function usePositions() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['positions', ws.workspaceId], queryFn: () => positionsFor(database, ws) });
}

export function usePrices(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['prices', ws.workspaceId, accountId], queryFn: () => listPrices(database, ws, accountId) });
}

export function useValuations(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['valuations', ws.workspaceId, accountId], queryFn: () => listValuations(database, ws, accountId) });
}

export function useMonthEndValues(accountId: string, months: string[]) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['month-end-values', ws.workspaceId, accountId, months.join(',')], queryFn: () => monthEndValues(database, ws, accountId, months) });
}

export function useTradeTemplates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['trade-templates', ws.workspaceId], queryFn: () => listTradeTemplates(database, ws) });
}

export function useDueTemplates(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['due-templates', ws.workspaceId, onDate], queryFn: () => dueTemplates(database, ws, onDate) });
}

/** Rates for every currency the workspace holds money in, fetched or manual, as the dashboard does. */
function useMoneyCurrencies(): string[] {
  const { ws } = useApp();
  const accounts = useAccounts();
  return [...new Set((accounts.data ?? []).filter(isMoneyAccount).map((account) => account.currency ?? ws.baseCurrency))];
}

export function useNetWorthSeries(months: string[]) {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const currencies = useMoneyCurrencies();
  const today = isoDate();
  return useQuery({
    queryKey: ['net-worth-series', ws.workspaceId, months.join(','), currencies.join(',')],
    queryFn: async () => {
      const rates = await resolveRates(currencies, today);
      return netWorthSeries(database, ws, months, rates.rates, today);
    },
    //
    // A longer range is more month-end snapshots to work out, so the months already read stay on screen until the
    // new ones arrive: a figure that empties itself for a moment is read as the money having gone somewhere.
    placeholderData: (previous) => previous,
  });
}

export function useSheet(date?: string) {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const currencies = useMoneyCurrencies();
  const onDate = date ?? isoDate();
  return useQuery({
    queryKey: ['sheet-inputs', ws.workspaceId, onDate, currencies.join(',')],
    queryFn: async () => {
      const rates = await resolveRates(currencies, onDate);
      return sheetInputsAt(database, ws, onDate, rates.rates);
    },
  });
}

export function usePeriodFlows(range: { from: string; to: string }) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['period-flows', ws.workspaceId, range.from, range.to],
    // Net worth is the owner's whole picture: every workspace, in the owner's own currency.
    queryFn: () => periodFlows(database, ownerScope(ws), range),
  });
}

/** One deposit's automation settings; a deposit with none reads as off. */
export function useDepositAutomation(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-automation', ws.workspaceId, accountId], queryFn: () => getDepositAutomation(database, ws, accountId) });
}

/** What every automated deposit has due today or earlier: the proposal on its page, the marker on its row. */
export function useDueDeposits() {
  const { database, ws } = useApp();
  const today = isoDate();
  return useQuery({ queryKey: ['deposit-due', ws.workspaceId, today], queryFn: () => listDueDeposits(database, ws, today) });
}

/** The deposit's hand-recorded events that "Undo recorded by hand" can take back now. */
export function useUndoableByHand(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-by-hand', ws.workspaceId, accountId], queryFn: () => listUndoableByHand(database, ws, accountId) });
}

/**
 * The active net-worth group as this workspace sees it, with what the other members share and their names
 * (joint-net-worth §8.2): null when there is no group, or the group's Household is not in this workspace — the items
 * this person shares are this workspace's accounts, so only here are the two sides one household.
 *
 * Keyed under `net-worth` and read through `useActiveNetWorthGroup`, so a sync run re-reads it: a partner's new
 * summary arrives with a run, not with a local write.
 */
export function useSharedNetWorth() {
  const { database, ws } = useApp();
  const group = useActiveNetWorthGroup();
  const active = group.data ?? null;
  const read = useQuery({
    queryKey: ['net-worth', 'received', ws.workspaceId, active?.groupBookId ?? null, active?.proposalId ?? null],
    enabled: active !== null,
    queryFn: async () => {
      if (!active) return null;
      const books = await listBooks(database, ws);
      if (!books.some((book) => book.id === active.workspaceBookId)) return null;
      const items: ReceivedItem[] = groupItems(await receivedItems(database, active.groupBookId), active.members);
      const detail = await sharingDetail(database, active.workspaceBookId, null);
      const names: Record<string, string> = {};
      for (const member of detail?.members ?? []) names[member.memberId] = member.name;
      return { group: active, items, names };
    },
  });
  return {
    ...read,
    isPending: group.isPending || (active !== null && read.isPending),
    error: group.error ?? (active !== null ? read.error : null),
    data: active === null ? null : (read.data ?? null),
  };
}

/** A member's name for a line of copy (pure, in joint-rows.ts so view-models share its fallback). */
export { memberName } from './joint-rows';

/**
 * The household's balance sheet when the group files jointly (§8.2, D12): own rows read live, as Net worth always has,
 * and the other's items converted with this device's rates on `date`. `status` says what the page may draw
 * (`jointStatus`): the personal sheet only once the group is known not to file jointly — while the group or the
 * household's inputs load it holds, and on an error it says so, never drawing the personal figure as the household's.
 */
export function useJointSheet(date?: string): {
  status: JointStatus;
  data: (JointRows & { members: string[]; names: Record<string, string>; me: string; received: ReceivedItem[]; ratesToBase: Record<string, number>; ownMissing: readonly string[] }) | null;
  error: unknown;
} {
  const { ws } = useApp();
  const resolveRates = useResolveRates();
  const onDate = date ?? isoDate();
  const shared = useSharedNetWorth();
  const own = useSheet(onDate);
  const joint = shared.data && shared.data.group.mode === 'joint' ? shared.data : null;
  const currencies = [...new Set((joint?.items ?? []).map((item) => item.currency))].sort();
  const rates = useQuery({
    queryKey: ['net-worth', 'received-rates', ws.workspaceId, onDate, currencies.join(',')],
    enabled: joint !== null,
    queryFn: async () => (await resolveRates(currencies, onDate)).rates,
  });
  const status = jointStatus({
    group: { pending: shared.isPending, error: shared.error, mode: shared.data?.group.mode ?? null },
    inputs: { pending: !own.data || !rates.data, error: own.error ?? rates.error },
  });
  const error = shared.error ?? (joint ? (own.error ?? rates.error) : null);
  if (status !== 'joint' || !joint || !own.data || !rates.data) return { status, data: null, error };
  const rows = jointRows(own.data, joint.items, joint.group.me, rates.data, ws.baseCurrency, { date: onDate, members: joint.group.members });
  return {
    status,
    data: { ...rows, members: joint.group.members, names: joint.names, me: joint.group.me, received: joint.items, ratesToBase: rates.data, ownMissing: own.data.missing },
    error: null,
  };
}

/** The Household purchases of an item's period, for its page's "Lines you can see" (§8.3). */
export function useHouseholdPurchases(bookId: string | null, period: { start: string; end: string } | null) {
  const { database } = useApp();
  return useQuery({
    queryKey: ['net-worth', 'household-purchases', bookId, period?.start, period?.end],
    enabled: bookId !== null && period !== null,
    queryFn: () => householdPurchases(database, bookId!, period!),
  });
}

/** The live transfers of an item's period with it on either side, for its page's "Lines you can see" (§8.3, task 8). */
export function useItemTransfers(groupBookId: string | null, itemId: string | null, period: { start: string; end: string } | null) {
  const { database } = useApp();
  return useQuery({
    queryKey: ['net-worth', 'item-transfers', groupBookId, itemId, period?.start, period?.end],
    enabled: groupBookId !== null && itemId !== null && period !== null,
    queryFn: () => itemTransfers(database, groupBookId!, itemId!, period!),
  });
}
