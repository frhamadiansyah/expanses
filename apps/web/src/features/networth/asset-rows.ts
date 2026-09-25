import { assetItemOfCode, type PlanGroup, SHEET_SECTION_LABELS, SHEET_SECTIONS, type SheetSectionKey, sheetSectionOf, sumToBase } from '@expanses/core';
import { type AccountRow, type AssetProfileRow, type AssetValueRow, pocketParentIds } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { CORETAX_SECTION_LABELS, METHOD_LABELS } from './labels';
import { type RowKind, rowKindOf } from './sheet-drawers';

export interface AssetRow {
  accountId: string;
  name: string;
  planGroup: PlanGroup;
  valueMinor: number;
  currency: string;
  /** How the value was worked out, for the tag on the row. */
  method: string;
  /** Coretax code and table, or an empty string when the asset has no profile yet. */
  coretax: string;
  stale: boolean;
  /** A holding that has been sold: nothing left, but kept for gains and the tax report. */
  sold: boolean;
  /** An automated deposit with a proposal waiting on its page. */
  due: boolean;
  /**
   * How many pockets this row adds up, or null for an ordinary asset. A row with pockets is their account: its
   * `valueMinor` is their total in the base currency, for display only — no total ever re-adds it.
   */
  pockets: number | null;
  /** The rates the row could not be added up without (a row with pockets only). */
  missing: string[];
  /** Whether any pocket is held in another currency, so the figure above was reached at a rate. */
  converted: boolean;
  /**
   * What kind of thing it is, in the same words the balance sheet folds by: a holding by the catalogue item it was
   * opened as — "Listed shares", "Gold bullion" — and money by the kind of account it sits in.
   */
  kind: RowKind;
  /** The category it is listed under, in the picker's own words: Investments, Immovable property, and so on. */
  section: SheetSectionKey;
  /** Who owes the money on a receivable, which is administrated by the Lend & borrow ledger. Null for the rest. */
  person: string | null;
}

export interface AssetGroup {
  group: SheetSectionKey;
  /** The category's own name, the one the picker that opens an asset uses. */
  label: string;
  /** The group in the base currency, or null when a rate is missing — never the sum of the rest. */
  totalMinor: number | null;
  missing: string[];
  rows: AssetRow[];
  /** The group's rows folded by what kind of thing each one is. */
  drawers: AssetDrawer[];
}

/** One kind of thing inside a group: what it is called, what it holds, and what its rows come to. */
export interface AssetDrawer {
  key: string;
  label: string;
  rows: AssetRow[];
  /** The drawer in the base currency, or null when a rate is missing — never the sum of the rest. */
  totalMinor: number | null;
  missing: string[];
}

function toRow(value: AssetValueRow, profile: AssetProfileRow | undefined, due: boolean, subtype: AccountRow['subtype']): AssetRow {
  /*
   * The code beside the name comes from the asset's own profile, and — for money owed to you — from the debt's, which
   * is the only place it was ever written. A code the catalogue knows names its own table, so no second read is needed
   * to say where it files.
   */
  const item = assetItemOfCode(value.coretaxCode);
  const code = profile?.coretaxCode ?? item?.code ?? null;
  const filed = profile?.coretaxSection ?? item?.section ?? null;
  return {
    accountId: value.accountId,
    name: value.name,
    planGroup: value.planGroup,
    valueMinor: value.valueMinor,
    currency: value.currency,
    method: METHOD_LABELS[value.mode],
    coretax: code && filed ? `${code} · ${CORETAX_SECTION_LABELS[filed] ?? filed}` : '',
    stale: value.stale,
    sold: value.mode === 'market' && value.unitsMicro === 0,
    due,
    pockets: null,
    missing: [],
    converted: false,
    // The balance sheet's own folding, read off the same two facts it reads: the section the asset is drawn in, and
    // the catalogue item its code names. Money is told apart by the kind of account it sits in.
    kind: kindOf(value.coretaxCode, value.accountId, subtype),
    section: sectionOf(value.coretaxCode, subtype),
    person: value.person,
  };
}

export interface AssetGrouping {
  accounts: readonly Pick<AccountRow, 'id' | 'name' | 'parentId' | 'kind' | 'subtype'>[];
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
  /** The deposits with a proposal waiting (spec §7). Every other caller leaves it out, and nothing is due. */
  due?: ReadonlySet<string>;
}

const isSold = (value: AssetValueRow) => value.mode === 'market' && value.unitsMicro === 0;

/**
 * What kind of thing a row is, in the balance sheet's own words.
 *
 * The same `rowKindOf` the sheet folds by, read off the same two facts it reads: the section the asset is drawn in,
 * and the catalogue item its code names. A holding keeps the item it was opened as — "Listed shares", not
 * "Investment" — and money is told apart by the kind of account it sits in.
 */
function kindOf(code: string | null, accountId: string, subtype: AccountRow['subtype']): RowKind {
  return rowKindOf(sectionOf(code, subtype), { accountId, code }, () => subtype);
}

/** The category an asset is listed under: the catalogue's family, or the kind of account it is for a row with no code. */
function sectionOf(code: string | null, subtype: string): SheetSectionKey {
  return sheetSectionOf({ code, subtype });
}

/**
 * A group's rows, folded by what each one is: current accounts with current accounts, listed shares with listed
 * shares. The order is the order the kinds first appear in, which is the order the rows were already in, so folding
 * changes what is drawn and never what is said.
 */
function assetDrawers(rows: readonly AssetRow[], under: ReadonlyMap<string, readonly AssetValueRow[]>, baseCurrency: string, ratesToBase: Readonly<Record<string, number>>): AssetDrawer[] {
  const drawers = new Map<string, { key: string; label: string; rows: AssetRow[] }>();
  for (const row of rows) {
    const drawer = drawers.get(row.kind.key) ?? { ...row.kind, rows: [] };
    drawer.rows.push(row);
    drawers.set(row.kind.key, drawer);
  }
  return [...drawers.values()].map((drawer) => {
    // The drawer's figure is the group's arithmetic one level down: the values behind its rows, each pocket on its
    // own, and the rate named rather than the rest added up when one is missing.
    const total = sumToBase({ amounts: drawer.rows.flatMap((row) => under.get(row.accountId) ?? []).map((value) => ({ minor: value.valueMinor, currency: value.currency })), baseCurrency, ratesToBase });
    return { ...drawer, totalMinor: total.totalMinor, missing: total.missing };
  });
}

/**
 * Assets in balance-sheet order. Sold holdings are listed but never counted in a total. An account with pockets is
 * one row, where its first pocket stood, at their ≈ total. Every total is converted into the base currency through
 * `sumToBase` over the underlying values — each pocket on its own, never the rounded parent figure — and is null,
 * naming the rate, when one is missing.
 */
export function groupAssets(values: AssetValueRow[], profiles: AssetProfileRow[], { accounts, baseCurrency, ratesToBase, due = new Set() }: AssetGrouping): AssetGroup[] {
  const profileByAccount = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const parents = pocketParentIds(accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const parentOf = new Map(accounts.filter((a) => a.parentId && parents.has(a.parentId) && byId.has(a.parentId)).map((a) => [a.id, a.parentId!]));
  const pocketsUnder = new Map<string, AssetValueRow[]>();
  for (const value of values) {
    const parentId = parentOf.get(value.accountId);
    if (parentId) pocketsUnder.set(parentId, [...(pocketsUnder.get(parentId) ?? []), value]);
  }

  const rows: AssetRow[] = [];
  /** The values behind each row: the row itself, or — for a row of pockets — each pocket on its own. */
  const under = new Map<string, AssetValueRow[]>();
  for (const value of values) {
    const parentId = parentOf.get(value.accountId);
    if (!parentId) {
      rows.push(toRow(value, profileByAccount.get(value.accountId), due.has(value.accountId), value.subtype));
      under.set(value.accountId, [value]);
      continue;
    }
    if (rows.some((row) => row.accountId === parentId)) continue;
    const pockets = pocketsUnder.get(parentId)!;
    // A pocket's account is the parent's account, so the parent's kind is the kind of money this row is.
    const parentSubtype = byId.get(parentId)?.subtype ?? value.subtype;
    const total = sumToBase({ amounts: pockets.map((p) => ({ minor: p.valueMinor, currency: p.currency })), baseCurrency, ratesToBase });
    under.set(parentId, pockets);
    rows.push({
      accountId: parentId,
      name: byId.get(parentId)!.name,
      planGroup: value.planGroup,
      valueMinor: total.totalMinor ?? 0,
      currency: baseCurrency,
      method: 'Pockets',
      coretax: 'Each pocket files its own row',
      stale: false,
      sold: false,
      // A deposit never holds pockets, so a row of pockets is never due.
      due: false,
      pockets: pockets.length,
      missing: total.missing,
      // A pockets row in one currency adds up exactly; only a conversion earns the ≈ its figure wears.
      converted: pockets.some((pocket) => pocket.currency !== baseCurrency),
      // A row of pockets is the account they sit in, so it is that account's kind of money.
      kind: kindOf(null, parentId, parentSubtype),
      section: sectionOf(null, parentSubtype),
      person: null,
    });
  }

  /*
   * The categories the list is drawn in are the picker's own, in its own order: a page that filed a car and a house
   * under "Personal use" while the form that opened them asked "Movable property" or "Immovable property" was two
   * taxonomies for one set of things.
   */
  return SHEET_SECTIONS.map((section) => {
    const groupRows = rows.filter((row) => row.section === section);
    const counted = values.filter((value) => sectionOf(value.coretaxCode, value.subtype) === section && !isSold(value));
    const total = sumToBase({ amounts: counted.map((value) => ({ minor: value.valueMinor, currency: value.currency })), baseCurrency, ratesToBase });
    return { group: section, label: SHEET_SECTION_LABELS[section], totalMinor: total.totalMinor, missing: total.missing, rows: groupRows, drawers: assetDrawers(groupRows, under, baseCurrency, ratesToBase) };
  }).filter((group) => group.rows.length > 0);
}

export const soldRows = (groups: AssetGroup[]): AssetRow[] => groups.flatMap((group) => group.rows.filter((row) => row.sold));
export const liveGroups = (groups: AssetGroup[]): AssetGroup[] =>
  groups.map((group) => ({ ...group, rows: group.rows.filter((row) => !row.sold) })).filter((group) => group.rows.length > 0);
/** Every group added up, or null with every missing rate named (sorted, once each) when any group has no total. */
export function totalOf(groups: readonly { totalMinor: number | null; missing: readonly string[] }[]): { totalMinor: number | null; missing: string[] } {
  const missing = [...new Set(groups.flatMap((group) => group.missing))].sort();
  if (missing.length > 0 || groups.some((group) => group.totalMinor === null)) return { totalMinor: null, missing };
  return { totalMinor: groups.reduce((total, group) => total + group.totalMinor!, 0), missing: [] };
}
export const staleRows = (groups: AssetGroup[]): AssetRow[] => groups.flatMap((group) => group.rows.filter((row) => row.stale && !row.sold));

/** What the row says under its name: how it is valued, its tax code, and whether it needs attention. */
export function rowSubtitle(row: AssetRow): string {
  return [row.method, row.coretax, row.stale && !row.sold ? 'Update price' : null, row.sold ? 'Sold' : null, row.due ? 'Due' : null]
    .filter(Boolean)
    .join(' · ');
}
