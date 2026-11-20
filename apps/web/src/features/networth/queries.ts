import { isoDate, type RingColour, resolveRings } from '@expanses/core';
import {
  listBondCoupons,
  acquiredDates,
  householdPurchases,
  itemTransfers,
  listBooks,
  ownSentAccountIds,
  receivedItems,
  ringPicks,
  sharingDetail,
  assetSaleOf,
  assetValuesAt,
  goneAssets,
  listAccounts,
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
  templateBuysIn,
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
import { withShownNames } from '../../lib/account-name';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';
import { useActiveNetWorthGroup, useJointAccountIds } from '../sharing/net-worth-queries';
import { groupItems, jointRows, type JointRows, jointStatus, type JointStatus, type ReceivedItem } from './joint-rows';

export function useAssetValues(date?: string, options: { enabled?: boolean } = {}) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({
    queryKey: ['asset-values', ws.workspaceId, onDate],
    enabled: options.enabled ?? true,
    // An account at a bank is listed by the name every screen shows it by ("Mandiri Xpresi"); `typedName` is what is stored.
    queryFn: async () => {
      const [values, accounts] = await Promise.all([assetValuesAt(database, ws, onDate), listAccounts(database, ws, { includeArchived: true })]);
      return withShownNames(values, accounts);
    },
  });
}

/** The assets that have left the list, sold or archived, for the foot of Assets (0092). */
export function useGoneAssets() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['gone-assets', ws.workspaceId], queryFn: () => goneAssets(database, ws) });
}

/** One asset's sale, or null while it is not sold. */
export function useAssetSale(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['asset-sale', ws.workspaceId, accountId], queryFn: () => assetSaleOf(database, ws, accountId) });
}

export function useIdleCash(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['idle-cash', ws.workspaceId, onDate], queryFn: () => idleCash(database, ws, onDate) });
}

/** How precisely each asset's acquired day was typed (0074); an asset missing from it was typed to the day. */
export function useAcquiredDates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['acquired-dates', ws.workspaceId], queryFn: () => acquiredDates(database, ws) });
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

/** What each monthly buy recorded in a month (`YYYY-MM`): the day it was bought and the money. */
export function useTemplateBuys(month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['template-buys', ws.workspaceId, month], queryFn: () => templateBuysIn(database, ws, month) });
}

/**
 * Rates for every currency the workspace holds money in, fetched or manual, as the dashboard does. `ready` once the
 * accounts are read: before then the list is empty, and a figure worked out from it is worked out again a moment later
 * with the currencies in it — on a large household the whole line twice, the first time for nothing.
 */
function useMoneyCurrencies(): { currencies: string[]; ready: boolean } {
  const { ws } = useApp();
  const accounts = useAccounts();
  return { currencies: [...new Set((accounts.data ?? []).filter(isMoneyAccount).map((account) => account.currency ?? ws.baseCurrency))], ready: accounts.isSuccess };
}

/**
 * `enabled: false` holds the line back: Net worth asks for it only once its figure and sheet are in, because every
 * read waits its turn on the one database, and a line read beside the sheet made the sheet wait for most of the line.
 */
export function useNetWorthSeries(months: string[], options: { enabled?: boolean } = {}) {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const { currencies, ready } = useMoneyCurrencies();
  const today = isoDate();
  return useQuery({
    queryKey: ['net-worth-series', ws.workspaceId, months.join(','), currencies.join(',')],
    enabled: ready && (options.enabled ?? true),
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
  const { currencies, ready } = useMoneyCurrencies();
  const onDate = date ?? isoDate();
  return useQuery({
    queryKey: ['sheet-inputs', ws.workspaceId, onDate, currencies.join(',')],
    enabled: ready,
    queryFn: async () => {
      const rates = await resolveRates(currencies, onDate);
      return sheetInputsAt(database, ws, onDate, rates.rates);
    },
  });
}

/**
 * `monthStart` names the day the months of `byMonth` start on: Financial health passes the open workspace's ("Month
 * starts on"), so its months are Cashflow's and Budget's. Left out, calendar months, as the calculators read them.
 */
export function usePeriodFlows(range: { from: string; to: string }, monthStart = 1) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['period-flows', ws.workspaceId, range.from, range.to, monthStart],
    // Net worth is the owner's whole picture: every workspace, in the owner's own currency.
    queryFn: () => periodFlows(database, ownerScope(ws), range, { monthStart }),
  });
}

/** One deposit's automation settings; a deposit with none reads as off. */
/** Every bond's coupon terms (0081), by bond account id. */
export function useBondCoupons() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bond-coupons', ws.workspaceId], queryFn: () => listBondCoupons(database, ws) });
}

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
/**
 * Whether a row is owned together (2026-11-13): one of this phone's own accounts made joint (and its pockets), or a
 * partner's shared item whose holder made it joint. What draws the two-person mark on a row's icon.
 */
export function useOwnedTogether(): (id: string) => boolean {
  const own = useJointAccountIds();
  const shared = useSharedNetWorth().data;
  const received = new Set((shared?.items ?? []).filter((item) => item.joint === true).map((item) => item.itemId));
  return (id: string) => own.has(id) || received.has(id);
}

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

/** Whose colour is whose in the active group (owner rings, 12 Nov), as `useOwnerRings` reads it. */
export interface OwnerRings {
  mode: 'joint' | 'separate';
  /** This phone's member id. */
  me: string;
  /** The group's members, in the order every phone derives alike. */
  members: string[];
  names: Record<string, string>;
  /** Each member's ring colour (`resolveRings`), the same on every phone. */
  rings: Record<string, RingColour>;
}

/**
 * The ring colour of each member of the active group, for this workspace — only from what this phone holds of the
 * group (its members, their names, and each one's own pick): never waiting on the other's items or on a rate, so
 * one's own rows are ringed as soon as the page draws. Null with no group, or outside the group's workspace.
 */
export function useOwnerRings(): OwnerRings | null {
  const { database, ws } = useApp();
  const group = useActiveNetWorthGroup();
  const active = group.data ?? null;
  const read = useQuery({
    queryKey: ['net-worth', 'rings', ws.workspaceId, active?.groupBookId ?? null, active?.proposalId ?? null],
    enabled: active !== null,
    queryFn: async (): Promise<OwnerRings | null> => {
      if (!active) return null;
      const books = await listBooks(database, ws);
      if (!books.some((book) => book.id === active.workspaceBookId)) return null;
      const detail = await sharingDetail(database, active.workspaceBookId, null);
      const names: Record<string, string> = {};
      for (const member of detail?.members ?? []) names[member.memberId] = member.name;
      const rings = resolveRings(active.members, await ringPicks(database, active.groupBookId));
      return { mode: active.mode, me: active.me, members: active.members, names, rings };
    },
  });
  return active === null ? null : (read.data ?? null);
}

/**
 * The ring colours of a workspace's net-worth group, for its Member page: null unless `bookId` is the workspace the
 * active group belongs to (either mode — a colour may be picked before the household files jointly).
 */
export function useBookRings(bookId: string): { me: string; members: string[]; rings: Record<string, RingColour> } | null {
  const { database } = useApp();
  const group = useActiveNetWorthGroup();
  const active = group.data && group.data.workspaceBookId === bookId ? group.data : null;
  const read = useQuery({
    queryKey: ['net-worth', 'rings', 'book', bookId, active?.groupBookId ?? null, active?.proposalId ?? null],
    enabled: active !== null,
    queryFn: async () => (active ? { me: active.me, members: active.members, rings: resolveRings(active.members, await ringPicks(database, active.groupBookId)) } : null),
  });
  return active === null ? null : (read.data ?? null);
}

/**
 * This phone's own accounts the household holds live (`ownSentAccountIds`): what the other member receives, and so the
 * only own accounts the household's Assets and Liabilities count. Keyed under `net-worth`, so a sync run re-reads it.
 */
export function useOwnSentIds(groupBookId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['net-worth', 'own-sent', ws.workspaceId, groupBookId],
    enabled: groupBookId !== null,
    queryFn: () => ownSentAccountIds(database, groupBookId!),
  });
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
