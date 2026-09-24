import type { PlanGroup } from './presets';

export interface SheetAsset {
  accountId: string;
  name: string;
  planGroup: PlanGroup;
  valueMinor: number;
}

export interface SheetLiability {
  accountId: string;
  name: string;
  subtype: 'credit_card' | 'loan' | 'payable';
  /** What is still owed, as a positive amount. */
  balanceMinor: number;
  /** Principal due in the next 12 months. Cards and personal debts owe all of it. */
  dueWithinYearMinor: number;
  note: string | null;
}

export interface SheetRow {
  accountId: string;
  name: string;
  amountMinor: number;
  note: string | null;
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

/** Group labels on the statement of financial position, in the order a planner reads them. */
export const SHEET_GROUP_LABELS: Record<PlanGroup, string> = {
  liquid: 'Cash & equivalents',
  invest: 'Investments',
  owed: 'Receivables',
  use: 'Personal use',
};
const GROUP_ORDER: PlanGroup[] = ['liquid', 'invest', 'owed', 'use'];

const total = (rows: SheetRow[]): number => rows.reduce((sum, row) => sum + row.amountMinor, 0);

/**
 * The statement of financial position: assets by group, the debts as one list and split by what falls due within a
 * year, and net worth underneath.
 */
export function balanceSheet(assets: SheetAsset[], liabilities: SheetLiability[]): BalanceSheet {
  const assetGroups = GROUP_ORDER.map((group) => {
    const rows = assets
      .filter((row) => row.planGroup === group)
      .map((row) => ({ accountId: row.accountId, name: row.name, amountMinor: row.valueMinor, note: null }));
    return { key: group, label: SHEET_GROUP_LABELS[group], totalMinor: total(rows), rows };
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
    if (later > 0) longRows.push({ accountId: debt.accountId, name: debt.name, amountMinor: later, note: debt.note });
  }
  const debts: SheetGroup = { key: 'debts', label: 'Debts', totalMinor: total(debtRows), rows: debtRows };
  const shortTerm: SheetGroup = { key: 'short', label: 'Due within a year', totalMinor: total(shortRows), rows: shortRows };
  const longTerm: SheetGroup = { key: 'long', label: 'Long-term', totalMinor: total(longRows), rows: longRows };

  const assetsTotalMinor = assetGroups.reduce((sum, group) => sum + group.totalMinor, 0);
  const liabilitiesTotalMinor = shortTerm.totalMinor + longTerm.totalMinor;
  return { assetGroups, assetsTotalMinor, debts, shortTerm, longTerm, liabilitiesTotalMinor, netWorthMinor: assetsTotalMinor - liabilitiesTotalMinor };
}
