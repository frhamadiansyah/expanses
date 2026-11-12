import { convertMinor, SHEET_SECTION_LABELS, SHEET_SECTIONS, sheetSectionOf, sumToBase } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { type AssetDrawer, type AssetGroup, type AssetRow, totalOf } from './asset-rows';
import { type DebtDrawer, type DebtGroup, type DebtKind, type DebtRow, DEBT_GROUP_LABELS, type DebtSheet } from './debt-rows';
import { memberName, ownerRing, receivedDebtIcon, type ReceivedItem } from './joint-rows';
import { debtKind, type RowKind, rowKindOf } from './sheet-drawers';

/*
 * The household's Assets and Liabilities pages (owner, 12 Nov: "one square per kind"): with one tax ID, the total, the
 * squares and the list count both people — this phone's own accounts as they always were, and every item the other
 * shares, at its shared balance — one list per kind mixing the two, each row knowing whose it is.
 *
 * Both phones draw the same page: a figure is the same sum of the same per-amount conversions whichever phone adds it,
 * a received item is filed by the same facts its owner's phone files it by (its subtype and `sheet` facts), and the
 * rows are put in the group's member order and then by name, never by which phone they live on. Only shared items
 * and their shared balances are read here; nothing private of the other's ever reaches this phone.
 */

export interface Household {
  /** This phone's member id. */
  me: string;
  /** The group's members, in the order every phone derives alike. */
  members: readonly string[];
  names: Record<string, string>;
  /** What the other members share (`receivedItems`, the active group's only). */
  received: readonly ReceivedItem[];
  /** Rates for the received items' currencies, as the household's Net worth converts them. */
  ratesToBase: Readonly<Record<string, number>>;
}

/** Whose a row is, as its initial draws it: the member's name and colour. */
export function memberMark(household: Pick<Household, 'members' | 'names'>, member: string): { name: string; colour: string | null } {
  return { name: memberName(household.names, member), colour: ownerRing(household.members, member) };
}

/** The line under the household's total: "Household · Rina and Budi", in the group's order on both phones. */
export function householdCaption(household: Pick<Household, 'members' | 'names'>): string {
  const names = household.members.map((member) => memberName(household.names, member));
  const listed = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Household · ${listed}`;
}

/** A total of two parts, or null with every missing rate named, as `totalOf` adds a page's groups. */
function plus(a: { totalMinor: number | null; missing: readonly string[] }, b: { totalMinor: number | null; missing: readonly string[] }): { totalMinor: number | null; missing: string[] } {
  return totalOf([a, b]);
}

/** Rows in the group's member order, then by name: the same order on every phone. */
function byMemberThenName<T extends { owner?: string; name: string }>(members: readonly string[], rows: readonly T[]): T[] {
  const place = (row: T) => {
    const index = members.indexOf(row.owner ?? '');
    return index < 0 ? members.length : index;
  };
  return [...rows].sort((a, b) => place(a) - place(b) || a.name.localeCompare(b.name, 'en') || 0);
}

const KNOWN_SUBTYPE = (subtype: string): AccountSubtype | undefined => (subtype in SUBTYPE_LABELS ? (subtype as AccountSubtype) : undefined);

/** A received asset as an Assets row: filed by the same two facts its owner's phone files it by. */
function receivedAssetRow(item: ReceivedItem): AssetRow & { kind: RowKind } {
  const code = item.sheet?.code ?? null;
  const section = sheetSectionOf({ code, subtype: item.subtype });
  return {
    accountId: item.itemId,
    name: item.name,
    planGroup: 'liquid',
    valueMinor: item.balanceMinor,
    currency: item.currency,
    method: '',
    coretax: '',
    stale: false,
    sold: false,
    due: false,
    pockets: null,
    missing: [],
    converted: false,
    kind: rowKindOf(section, { accountId: item.itemId, code }, () => KNOWN_SUBTYPE(item.subtype)),
    section,
    person: null,
    owner: item.owner,
    received: true,
  };
}

/**
 * The Assets page's groups for the household: `own` (this phone's live groups, as `groupAssets` read them) with every
 * shared asset of the other members filed into the same sections and drawers. A section or drawer's figure is its own
 * part as before plus the received items in it, converted at `ratesToBase`; a missing rate blanks it and is named.
 */
export function householdAssetGroups(own: readonly AssetGroup[], household: Household, baseCurrency: string): AssetGroup[] {
  const received = household.received.filter((item) => item.kind === 'asset' && household.members.includes(item.owner)).map(receivedAssetRow);
  const sumOf = (rows: readonly AssetRow[]) => sumToBase({ amounts: rows.map((row) => ({ minor: row.valueMinor, currency: row.currency })), baseCurrency, ratesToBase: household.ratesToBase });
  return SHEET_SECTIONS.flatMap((section): AssetGroup[] => {
    const mine = own.find((group) => group.group === section);
    const theirs = received.filter((row) => row.section === section);
    if (!mine && theirs.length === 0) return [];
    const rows = byMemberThenName(household.members, [...(mine?.rows ?? []).map((row) => ({ ...row, owner: household.me })), ...theirs]);
    const drawers = new Map<string, AssetDrawer>();
    for (const row of rows) {
      const drawer = drawers.get(row.kind.key) ?? { key: row.kind.key, label: row.kind.label, rows: [], totalMinor: 0, missing: [] };
      drawer.rows.push(row);
      drawers.set(row.kind.key, drawer);
    }
    const nothing = { totalMinor: 0, missing: [] };
    const folded = [...drawers.values()].map((drawer) => {
      const ownPart = mine?.drawers.find((each) => each.key === drawer.key) ?? nothing;
      return { ...drawer, ...plus(ownPart, sumOf(drawer.rows.filter((row) => row.received))) };
    });
    return [{ group: section, label: mine?.label ?? SHEET_SECTION_LABELS[section], ...plus(mine ?? nothing, sumOf(theirs)), rows, drawers: folded }];
  });
}

const DEBT_ORDER: DebtKind[] = ['loan', 'card', 'person'];
const debtKindOf = (subtype: string): DebtKind => (subtype === 'credit_card' ? 'card' : subtype === 'payable' ? 'person' : 'loan');

/** A received debt as a Liabilities row, in its own currency and the base; one owing nothing is left out, as an own one is. */
function receivedDebtRow(item: ReceivedItem, baseCurrency: string, ratesToBase: Readonly<Record<string, number>>): DebtRow | null {
  if (item.balanceMinor <= 0) return null;
  const rate = item.currency === baseCurrency ? null : (ratesToBase[item.currency] ?? null);
  const known = item.currency === baseCurrency || (rate !== null && rate > 0);
  return {
    key: item.itemId,
    kind: debtKindOf(item.subtype),
    accountId: item.itemId,
    personName: null,
    name: item.name,
    detail: '',
    icon: receivedDebtIcon(item),
    last4: null,
    minor: item.balanceMinor,
    currency: item.currency,
    baseMinor: item.currency === baseCurrency ? item.balanceMinor : known ? convertMinor(item.balanceMinor, item.currency, baseCurrency, rate!) : null,
    missing: known ? null : item.currency,
    rate: known ? rate : null,
    owner: item.owner,
    received: true,
  };
}

/**
 * The Liabilities page's sheet for the household: `own` (as `groupDebts` read it) with every shared debt of the other
 * members in the same groups and drawers. `items` is this phone's own loans' catalogue items, by account; a received
 * loan brings its own. What falls due within a year stays this phone's own reading: a summary carries no schedule.
 */
export function householdDebtSheet(own: DebtSheet, household: Household, baseCurrency: string, items: Readonly<Record<string, string>> = {}): DebtSheet {
  const received = household.received
    .filter((item) => item.kind === 'liability' && household.members.includes(item.owner))
    .flatMap((item) => receivedDebtRow(item, baseCurrency, household.ratesToBase) ?? []);
  const itemOf = new Map<string, string | null>(household.received.map((item) => [item.itemId, item.sheet?.item ?? null]));
  const sumOf = (rows: readonly DebtRow[]) => sumToBase({ amounts: rows.map((row) => ({ minor: row.minor, currency: row.currency })), baseCurrency, ratesToBase: household.ratesToBase });
  const nothing = { totalMinor: 0, missing: [] };
  const groups = DEBT_ORDER.flatMap((kind): DebtGroup[] => {
    const mine = own.groups.find((group) => group.kind === kind);
    const theirs = received.filter((row) => row.kind === kind);
    if (!mine && theirs.length === 0) return [];
    const rows = byMemberThenName(household.members, [...(mine?.rows ?? []).map((row) => ({ ...row, owner: household.me })), ...theirs]);
    const drawers = new Map<string, DebtDrawer>();
    for (const row of rows) {
      const found = debtKind(row.received ? (itemOf.get(row.key) ?? null) : (items[row.accountId ?? ''] ?? null), row.icon);
      const drawer = drawers.get(found.key) ?? { key: found.key, label: found.label, rows: [], totalMinor: 0, missing: [] };
      drawer.rows.push(row);
      drawers.set(found.key, drawer);
    }
    const folded = [...drawers.values()].map((drawer) => {
      const ownPart = mine?.drawers.find((each) => each.key === drawer.key) ?? nothing;
      return { ...drawer, ...plus(ownPart, sumOf(drawer.rows.filter((row) => row.received))) };
    });
    return [{ kind, label: mine?.label ?? DEBT_GROUP_LABELS[kind], ...plus(mine ?? nothing, sumOf(theirs)), rows, drawers: folded }];
  });
  return { ...own, groups, total: totalOf(groups) };
}
