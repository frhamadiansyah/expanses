import { addMonths, balanceSheet, monthOf, type HealthRatio, type RatioStatus, type SheetAsset, type SheetLiability, type SheetTotals } from '@expanses/core';

export type RatioPeriod = { key: 'ttm' } | { key: 'year'; year: number };

export interface PeriodRange {
  from: string;
  to: string;
  /** Balances are read on this date: today for the rolling year, 31 Dec for a calendar year. */
  balanceDate: string;
  label: string;
}

/** The last 12 months end today; a calendar year runs 1 Jan to 31 Dec with balances at its end. */
export function periodRange(period: RatioPeriod, today: string): PeriodRange {
  if (period.key === 'year') {
    return { from: `${period.year}-01-01`, to: `${period.year}-12-31`, balanceDate: `${period.year}-12-31`, label: String(period.year) };
  }
  return { from: `${addMonths(monthOf(today), -11)}-01`, to: today, balanceDate: today, label: 'Last 12 months' };
}

/** Years worth offering in the period switch: this year back to the first year with data. */
export function periodChoices(today: string, earliestYear: number): RatioPeriod[] {
  const thisYear = Number(today.slice(0, 4));
  const years: RatioPeriod[] = [];
  for (let year = thisYear; year >= Math.min(earliestYear, thisYear); year -= 1) years.push({ key: 'year', year });
  return [{ key: 'ttm' }, ...years];
}

export const STATUS_LABELS: Record<RatioStatus, string> = {
  good: 'On track',
  watch: 'Watch',
  act: 'Act now',
  unknown: 'Not enough data',
};

export interface RatioDisplay {
  value: string;
  statusLabel: string;
  /** Width of the filled part of the gauge, 0 to 100. */
  gaugePercent: number;
  /** Where the guide mark sits on the gauge, 0 to 100. */
  targetPercent: number;
}

const oneDecimal = (value: number) => value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function ratioDisplay(ratio: HealthRatio): RatioDisplay {
  const targetPercent = Math.min(100, (ratio.target / ratio.max) * 100);
  if (ratio.value === null) return { value: '—', statusLabel: STATUS_LABELS.unknown, gaugePercent: 0, targetPercent };
  const value = ratio.unit === 'months' ? `${oneDecimal(ratio.value)} months` : `${oneDecimal(ratio.value)}%`;
  const gaugePercent = Math.max(0, Math.min(100, (ratio.value / ratio.max) * 100));
  return { value, statusLabel: STATUS_LABELS[ratio.status], gaugePercent, targetPercent };
}

/**
 * The balance-sheet totals the ratios read on the period's balance date — or none, with the currencies named, while
 * any row there has no rate: `sheetInputsAt` gives such a row 0, so a ratio built from it would be wrong, not partial.
 */
export function ratioTotals(inputs: { assets: SheetAsset[]; liabilities: SheetLiability[]; missing: readonly string[] } | undefined): {
  totals: SheetTotals | null;
  missing: string[];
} {
  const missing = [...(inputs?.missing ?? [])];
  if (missing.length > 0) return { totals: null, missing };
  const sheet = balanceSheet(inputs?.assets ?? [], inputs?.liabilities ?? []);
  const groupTotal = (key: string) => sheet.assetGroups.find((group) => group.key === key)?.totalMinor ?? 0;
  return {
    totals: {
      liquidMinor: groupTotal('liquid'),
      investMinor: groupTotal('invest'),
      assetsMinor: sheet.assetsTotalMinor,
      liabilitiesMinor: sheet.liabilitiesTotalMinor,
      netWorthMinor: sheet.netWorthMinor,
    },
    missing: [],
  };
}
