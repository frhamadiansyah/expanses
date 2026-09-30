import { convertMinor, type DebtIcon, type ItemSummary, type PlanGroup, type SheetAsset, type SheetLiability, sheetSectionOf } from '@expanses/core';
import type { LiabilityKind, NetWorthPoint } from '@expanses/db';

/*
 * The household's Net worth (joint-net-worth spec §8.2, D12): this phone's own rows, read live from its ledger as Net
 * worth always has, and every item the other member shares, from its summary — one list, folded into the same drawers
 * by kind, each row knowing whose it is. Nothing here reads the database: the page hands it what it read.
 */

/** A summary received from another member, known by its `itemId` (never an account id: §5.1). */
export type ReceivedItem = ItemSummary & { itemId: string };

/** This phone's own balance sheet inputs, as `sheetInputsAt` reads them: already in the base currency. */
export interface OwnSheet {
  assets: SheetAsset[];
  liabilities: SheetLiability[];
  /** Currencies of own rows with no rate: those rows read 0, so no total built from them may be shown. */
  missing: readonly string[];
}

/** One row of the joint sheet: whose it is, what it is, and what it is worth in its own currency and in the base. */
export interface OverviewRow {
  /** An own account's id, or a received item's `itemId`. */
  accountId: string;
  side: 'asset' | 'liability';
  name: string;
  subtype: string;
  currency: string;
  /** In `currency`: what an asset holds, what a liability owes. */
  nativeMinor: number;
  /** In the base currency; null while `currency` has no rate. */
  amountMinor: number | null;
  /** True for another member's item: tapping it opens their item's page (§8.3). */
  received: boolean;
}

export interface JointRows {
  rows: (OverviewRow & { owner: string })[];
  /** What `balanceSheet` folds, own and received together; a received row with no rate reads 0 here, as an own one does. */
  assets: (SheetAsset & { owner: string })[];
  liabilities: (SheetLiability & { owner: string })[];
  /** The household's net worth in the base currency; null when any row lacks a rate (Review Focus 4). */
  totalMinor: number | null;
  /** Each member's part of it; null for a member any of whose rows lacks a rate. */
  byOwner: Record<string, number | null>;
  /** Every currency with no rate, own and received, sorted. */
  missing: string[];
  /** Received items with no value on the date asked: older than the month-ends they sent (§5.2). Their owner's part is blank. */
  noHistory: string[];
}

/** What a received asset is planned as, by the kind of account it is. Not read by the sheet; kept for its shape. */
function planGroupOf(subtype: string): PlanGroup {
  if (subtype === 'investment') return 'invest';
  if (subtype === 'receivable') return 'owed';
  if (subtype === 'property' || subtype === 'vehicle') return 'use';
  return 'liquid';
}

/** How a received debt is drawn: a summary carries no loan terms, so a loan is a loan of no particular kind. */
function debtIconOf(subtype: string): DebtIcon {
  if (subtype === 'credit_card') return 'card';
  if (subtype === 'payable') return 'person';
  return 'loan';
}

const LIABILITY_SUBTYPES = new Set(['credit_card', 'loan', 'payable']);

/**
 * What a received item was worth in `month` (or on `date`): its balance from the owner's day (its month) on, else the
 * month-end it sent for that month (the last 24 travel with it, §5.2). A month older than those is unknown — null,
 * never 0: the summary holds no more history, and a 0 would be a figure made up (review round 1, finding 6).
 */
function balanceOn(item: ReceivedItem, date: string | undefined): number | null {
  if (date === undefined || date >= item.asOf) return item.balanceMinor;
  return monthEndOf(item, date.slice(0, 7));
}

function monthEndOf(item: ReceivedItem, month: string): number | null {
  if (month >= item.asOf.slice(0, 7)) return item.balanceMinor;
  return item.monthEnds.find((end) => end.month === month)?.balanceMinor ?? null;
}

/** An item's amount in the base currency: null with no rate for its currency. A zero needs no rate. */
function toBase(nativeMinor: number, currency: string, baseCurrency: string, ratesToBase: Record<string, number>): number | null {
  if (currency === baseCurrency || nativeMinor === 0) return nativeMinor;
  const rate = ratesToBase[currency];
  return rate !== undefined && rate > 0 ? convertMinor(nativeMinor, currency, baseCurrency, rate) : null;
}

/**
 * The joint sheet. `own` is this phone's own inputs (base currency, own `missing`); `received` the other members'
 * summaries, each converted with this viewer's `ratesToBase` exactly as an own row is (a missing rate leaves the row
 * with its native balance and blanks its owner's subtotal and the total). `date`, when earlier than a summary's day,
 * reads that item's month-end instead of today's balance.
 */
export function jointRows(
  own: OwnSheet,
  received: readonly ReceivedItem[],
  me: string,
  ratesToBase: Record<string, number>,
  baseCurrency: string,
  { date, members = [] }: { date?: string; members?: readonly string[] } = {},
): JointRows {
  const rows: JointRows['rows'] = [];
  const assets: JointRows['assets'] = [];
  const liabilities: JointRows['liabilities'] = [];
  // Every member of the group has a part, 0 until they share something: a legend's dash means "cannot tell", not "none".
  const byOwner: Record<string, number | null> = { [me]: 0 };
  for (const member of members) byOwner[member] = 0;
  const missing = new Set<string>(own.missing);
  const noHistory: string[] = [];
  const add = (owner: string, minor: number | null) => {
    const current = owner in byOwner ? byOwner[owner]! : 0;
    byOwner[owner] = current === null || minor === null ? null : current + minor;
  };

  for (const asset of own.assets) {
    rows.push({ accountId: asset.accountId, side: 'asset', name: asset.name, subtype: asset.subtype, currency: baseCurrency, nativeMinor: asset.valueMinor, amountMinor: asset.valueMinor, received: false, owner: me });
    assets.push({ ...asset, owner: me });
    add(me, asset.valueMinor);
  }
  for (const debt of own.liabilities) {
    rows.push({ accountId: debt.accountId, side: 'liability', name: debt.name, subtype: debt.subtype, currency: baseCurrency, nativeMinor: debt.balanceMinor, amountMinor: debt.balanceMinor, received: false, owner: me });
    liabilities.push({ ...debt, owner: me });
    add(me, -debt.balanceMinor);
  }
  // An own row with no rate read 0 in `sheetInputsAt`: the viewer's own part cannot be told.
  if (own.missing.length > 0) byOwner[me] = null;

  for (const item of received) {
    const known = balanceOn(item, date);
    if (known === null) noHistory.push(item.name);
    const nativeMinor = known ?? 0;
    const amountMinor = known === null ? null : toBase(known, item.currency, baseCurrency, ratesToBase);
    if (known !== null && amountMinor === null) missing.add(item.currency);
    const side = item.kind === 'liability' ? 'liability' : 'asset';
    rows.push({ accountId: item.itemId, side, name: item.name, subtype: item.subtype, currency: item.currency, nativeMinor, amountMinor, received: true, owner: item.owner });
    if (side === 'asset') {
      assets.push({ accountId: item.itemId, name: item.name, planGroup: planGroupOf(item.subtype), valueMinor: amountMinor ?? 0, code: null, subtype: item.subtype, owner: item.owner });
      add(item.owner, amountMinor);
    } else {
      // A debt of nothing owed is not on the sheet, exactly as an own one is left out by `sheetInputsAt`.
      if (amountMinor !== null && amountMinor <= 0) {
        add(item.owner, 0);
        continue;
      }
      const subtype = (LIABILITY_SUBTYPES.has(item.subtype) ? item.subtype : 'loan') as SheetLiability['subtype'];
      const owed = amountMinor ?? 0;
      // Not due within a year: a summary carries no schedule, so nothing is said about when it falls due (the sheet
      // lists it as long-term; its whole balance still counts in what is owed). Review round 1, finding 5.
      liabilities.push({ accountId: item.itemId, name: item.name, subtype, balanceMinor: owed, dueWithinYearMinor: 0, note: null, item: null, icon: debtIconOf(item.subtype), owner: item.owner });
      add(item.owner, amountMinor === null ? null : -amountMinor);
    }
  }

  const parts = Object.values(byOwner);
  const totalMinor = missing.size > 0 || parts.some((part) => part === null) ? null : parts.reduce<number>((sum, part) => sum + part!, 0);
  return { rows, assets, liabilities, totalMinor, byOwner, missing: [...missing].sort(), noHistory };
}

/**
 * A drawer's or section's figure: its total, or blank when any row in it has no base figure — a received row with no
 * rate is drawn in its own currency, and a sum that counted it as 0 would be short (review round 1, finding 2).
 */
export function figureOf(totalMinor: number, accountIds: readonly string[], unrated: ReadonlySet<string>): number | null {
  return accountIds.some((id) => unrated.has(id)) ? null : totalMinor;
}

/**
 * What the Net worth page may show (review round 1, finding 1): `personal` only once the group is known not to file
 * jointly; `joint` once the household's inputs are all in; otherwise it holds (`pending`) or says it failed (`error`),
 * so a personal figure is never drawn where the household's belongs.
 */
export type JointStatus = 'personal' | 'pending' | 'error' | 'joint';
export function jointStatus(p: {
  group: { pending: boolean; error: unknown; mode: 'joint' | 'separate' | null };
  inputs: { pending: boolean; error: unknown };
}): JointStatus {
  if (p.group.error) return 'error';
  if (p.group.pending) return 'pending';
  if (p.group.mode !== 'joint') return 'personal';
  if (p.inputs.error) return 'error';
  return p.inputs.pending ? 'pending' : 'joint';
}

/**
 * The ring an owner's rows wear (§8.2): `--owner-1`, `--owner-2`, … by the owner's place in the active group's
 * `members`, which every phone derives alike, so Rina is the same colour on both phones. Null for someone not listed.
 */
export function ownerRing(members: readonly string[], owner: string): string | null {
  const index = members.indexOf(owner);
  return index < 0 ? null : `var(--owner-${Math.min(index, 5) + 1})`;
}

/**
 * The household's line (§8.2): each month of this phone's own series with every received item added — its month-end
 * for an earlier month, today's balance for the month of its summary — converted with the same rates as the series,
 * into the figure and into the stacks the bars draw (an asset by the section its kind reads as, a debt by its kind).
 * A month an item has no rate for has no figure and no stack, and names the currency, as an own row does.
 */
export function jointSeries(points: readonly NetWorthPoint[], received: readonly ReceivedItem[], ratesToBase: Record<string, number>, baseCurrency: string): NetWorthPoint[] {
  return points.map((point) => {
    let assets = 0;
    let owed = 0;
    let unknown = false;
    const missing = new Set(point.missing);
    const stack = point.stack ? { assets: { ...point.stack.assets }, liabilities: { ...point.stack.liabilities } } : null;
    for (const item of received) {
      const native = monthEndOf(item, point.month);
      // Older than the month-ends it sent: the month cannot be told, so it has no figure and the line breaks there.
      if (native === null) {
        unknown = true;
        continue;
      }
      const minor = toBase(native, item.currency, baseCurrency, ratesToBase);
      if (minor === null) {
        missing.add(item.currency);
        continue;
      }
      if (item.kind === 'liability') {
        owed += minor;
        const kind = (LIABILITY_SUBTYPES.has(item.subtype) ? item.subtype : 'loan') as LiabilityKind;
        if (stack) stack.liabilities[kind] += minor;
      } else {
        assets += minor;
        if (stack) stack.assets[sheetSectionOf({ code: null, subtype: item.subtype })] += minor;
      }
    }
    if (unknown || missing.size > point.missing.length || point.netWorthMinor === null) {
      return { ...point, assetsMinor: null, liabilitiesMinor: null, netWorthMinor: null, missing: [...missing].sort(), stack: null };
    }
    return {
      ...point,
      assetsMinor: point.assetsMinor === null ? null : point.assetsMinor + assets,
      liabilitiesMinor: point.liabilitiesMinor === null ? null : point.liabilitiesMinor + owed,
      netWorthMinor: point.netWorthMinor + assets - owed,
      stack,
    };
  });
}
