import { assetFamilyOfCode, type OwnableFamily } from './catalogue';
import type { PlanGroup } from './presets';

export interface SheetAsset {
  accountId: string;
  name: string;
  planGroup: PlanGroup;
  valueMinor: number;
  /**
   * The catalogue code the asset was opened under — `0303` listed shares, `0701` gold — where it has one.
   *
   * It is the only trace an asset keeps of the item it was opened as, and the whole reason a statement can list
   * shares beside gold rather than lumping both into "Investments".
   */
  code?: string | null;
  /**
   * The kind of account it is, which is what a row the catalogue cannot name is read by: a house opened from the
   * Accounts page is still immovable property, and a car is still movable. Required, because a row that does not say
   * what it is has nowhere to be listed but among the money.
   */
  subtype: string;
}

/**
 * How a debt is drawn: what it is, and — for a loan — what the money went on.
 *
 * A loan against a property is a mortgage and one against a vehicle is a lease, which is what the debt's own row
 * wears, and which is the closest thing to a kind a loan nobody has classified has.
 */
export type DebtIcon = 'home' | 'car' | 'loan' | 'card' | 'person';

export interface SheetLiability {
  accountId: string;
  name: string;
  subtype: 'credit_card' | 'loan' | 'payable';
  /** What is still owed, as a positive amount. */
  balanceMinor: number;
  /** Principal due in the next 12 months. Cards and personal debts owe all of it. */
  dueWithinYearMinor: number;
  note: string | null;
  /**
   * The catalogue item the debt was opened as — `home_mortgage`, `vehicle_leasing`, `online_loan` — where it was
   * opened through the picker. Absent for a debt nobody has classified.
   */
  item?: string | null;
  /** What the debt is, and what a loan is against. Absent for a row read before this was kept. */
  icon?: DebtIcon;
}

export interface SheetRow {
  accountId: string;
  name: string;
  amountMinor: number;
  note: string | null;
  /** The asset's catalogue code, where it has one. Null for a debt, which is read by its kind instead. */
  code?: string | null;
}

export interface SheetGroup {
  key: string;
  label: string;
  totalMinor: number;
  rows: SheetRow[];
}

export interface BalanceSheet {
  assetGroups: SheetGroup[];
  assetsTotalMinor: number;
  /**
   * Every debt once, whole: what is owed on each, and not the part of it that falls due this year.
   *
   * The two groups below answer *when*, and a debt with a schedule is in both of them — which is right for a schedule
   * and wrong for a list of what you owe, where a mortgage read twice reads as two mortgages.
   */
  debts: SheetGroup;
  shortTerm: SheetGroup;
  longTerm: SheetGroup;
  liabilitiesTotalMinor: number;
  netWorthMinor: number;
}

/**
 * The categories the assets side is drawn in, in the order a planner reads them.
 *
 * Four of the six are the catalogue's own families under the names the pickers use — Receivables, Investments,
 * Movable property, Immovable property, Intangible and other — because a page that says "Personal use" about a list
 * somebody opened as "a car" and "a house" is a page speaking a language of its own. Money is the sixth: the picker
 * for it is Add account, and cash is money rather than a thing you own.
 */
export type SheetSectionKey = 'liquid' | 'receivable' | 'invest' | 'movable' | 'immovable' | 'other';

export const SHEET_SECTION_LABELS: Record<SheetSectionKey, string> = {
  liquid: 'Cash & equivalents',
  receivable: 'Receivables',
  invest: 'Investments',
  movable: 'Movable property',
  immovable: 'Immovable property',
  other: 'Intangible and other',
};
const SECTION_ORDER: SheetSectionKey[] = ['liquid', 'receivable', 'invest', 'movable', 'immovable', 'other'];

/**
 * The sections, in the order a planner reads them — and the order a chart stacks them.
 *
 * Exported because the order is not an implementation detail anywhere it is used: a bar that stacked gold under the
 * cash one month and over it the next would be a drawing of a different month each time.
 */
export const SHEET_SECTIONS: readonly SheetSectionKey[] = SECTION_ORDER;

/** The section each of the catalogue's families is drawn in: one family, one category, with the same name. */
const SECTION_BY_FAMILY: Record<OwnableFamily, SheetSectionKey> = {
  receivable: 'receivable',
  invest: 'invest',
  movable: 'movable',
  immovable: 'immovable',
  other: 'other',
};

/** What each kind of account is, where the catalogue cannot name one: the rest is money. */
const SECTION_BY_SUBTYPE: Record<string, SheetSectionKey> = {
  vehicle: 'movable',
  property: 'immovable',
  receivable: 'receivable',
  investment: 'invest',
};

/**
 * The section an asset is drawn in.
 *
 * The catalogue decides it wherever the asset's code names a family, because the catalogue is where the taxonomy
 * lives and where the asset was opened: gold leaves Investments for "Intangible and other", and a house bought as an
 * immovable is listed as one. A row the catalogue cannot name is read by the kind of account it is — a car is movable
 * property, a house is immovable, money owed to you is a receivable, a holding is an investment — and every other
 * account is money.
 */
export function sheetSectionOf(asset: { code?: string | null; subtype: string }): SheetSectionKey {
  const family = assetFamilyOfCode(asset.code ?? null) as OwnableFamily | null;
  if (family) return SECTION_BY_FAMILY[family];
  return SECTION_BY_SUBTYPE[asset.subtype] ?? 'liquid';
}

const total = (rows: SheetRow[]): number => rows.reduce((sum, row) => sum + row.amountMinor, 0);

/**
 * The statement of financial position: assets by group, the debts as one list and split by what falls due within a
 * year, and net worth underneath.
 */
export function balanceSheet(assets: SheetAsset[], liabilities: SheetLiability[]): BalanceSheet {
  const assetGroups = SECTION_ORDER.map((section) => {
    const rows = assets
      .filter((row) => sheetSectionOf(row) === section)
      .map((row) => ({ accountId: row.accountId, name: row.name, amountMinor: row.valueMinor, note: null, code: row.code ?? null }));
    return { key: section, label: SHEET_SECTION_LABELS[section], totalMinor: total(rows), rows };
  }).filter((group) => group.rows.length > 0);
  const debtRows: SheetRow[] = [];
  const shortRows: SheetRow[] = [];
  const longRows: SheetRow[] = [];
  for (const debt of liabilities) {
    if (debt.balanceMinor <= 0) continue;
    const withinYear = Math.min(Math.max(debt.dueWithinYearMinor, 0), debt.balanceMinor);
    const later = debt.balanceMinor - withinYear;
    debtRows.push({ accountId: debt.accountId, name: debt.name, amountMinor: debt.balanceMinor, note: debt.note });
    if (withinYear > 0) shortRows.push({ accountId: debt.accountId, name: debt.name, amountMinor: withinYear, note: debt.note });
    if (later > 0) longRows.push({ accountId: debt.accountId, name: debt.name, amountMinor: later, note: debt.note });  }
  const debts: SheetGroup = { key: 'debts', label: 'Liabilities', totalMinor: total(debtRows), rows: debtRows };
  const shortTerm: SheetGroup = { key: 'short', label: 'Due within a year', totalMinor: total(shortRows), rows: shortRows };
  const longTerm: SheetGroup = { key: 'long', label: 'Long-term', totalMinor: total(longRows), rows: longRows };

  const assetsTotalMinor = assetGroups.reduce((sum, group) => sum + group.totalMinor, 0);
  const liabilitiesTotalMinor = shortTerm.totalMinor + longTerm.totalMinor;
  return { assetGroups, assetsTotalMinor, debts, shortTerm, longTerm, liabilitiesTotalMinor, netWorthMinor: assetsTotalMinor - liabilitiesTotalMinor };
}
