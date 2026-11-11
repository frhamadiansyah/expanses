import { addMonths, convertMinor, monthOf } from '@expanses/core';
import type { DebtMovement } from '@expanses/db';
import type { PlanDebt, PlanItem } from './plan-inputs';
import { dueFigure, paidFigure } from './schedule-view';

/** The Report (spec §4.4, §6.10): a period's figures from the debts' own movements, and paid against due by month. Pure. */

export type ReportPeriod = 'month' | '3m' | 'year' | 'all';

export const PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '3m', label: '3 months' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All' },
];

function range(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** The months a period covers, oldest first: this month, the last three, January on, or from the earliest movement. */
export function periodMonths(period: ReportPeriod, today: string, earliest: string | null): string[] {
  const current = monthOf(today);
  if (period === 'month') return [current];
  if (period === '3m') return range(addMonths(current, -2), current);
  if (period === 'year') return range(`${current.slice(0, 4)}-01`, current);
  const first = earliest ? monthOf(earliest) : current;
  return range(first < current ? first : current, current);
}

/**
 * Borrowed (every increase), Repaid (every decrease), Interest paid (interest lines on payments) over the months, and
 * Left today. `currencyOf` names each account's currency; a currency with no rate leaves the figures out, named.
 */
export function reportFigures(
  movements: readonly DebtMovement[],
  debts: readonly PlanDebt[],
  months: readonly string[],
  baseCurrency: string,
  ratesToBase: Readonly<Record<string, number>>,
  currencyOf: Readonly<Record<string, string>> = {},
): { borrowedMinor: number | null; repaidMinor: number | null; interestMinor: number | null; leftMinor: number | null; missing: string[] } {
  const inPeriod = new Set(months);
  const missing = new Set<string>();
  let borrowed = 0;
  let repaid = 0;
  let interest = 0;
  for (const m of movements) {
    if (!inPeriod.has(monthOf(m.occurredOn))) continue;
    const currency = currencyOf[m.accountId] ?? debts.find((d) => d.accountId === m.accountId)?.currency ?? baseCurrency;
    const rate = currency === baseCurrency ? 1 : ratesToBase[currency];
    if (rate === undefined || !(rate > 0)) {
      missing.add(currency);
      continue;
    }
    const base = (minor: number) => (currency === baseCurrency ? minor : convertMinor(minor, currency, baseCurrency, rate));
    if (m.amountMinor < 0) borrowed += base(-m.amountMinor);
    else {
      repaid += base(m.amountMinor);
      interest += base(m.interestMinor);
    }
  }
  const owing = debts.filter((d) => !d.paidOff && d.leftMinor > 0);
  for (const d of owing) if (d.leftBase === null) missing.add(d.currency);
  const known = missing.size === 0;
  return {
    borrowedMinor: known ? borrowed : null,
    repaidMinor: known ? repaid : null,
    interestMinor: known ? interest : null,
    leftMinor: owing.some((d) => d.leftBase === null) ? null : owing.reduce((sum, d) => sum + (d.leftBase ?? 0), 0),
    missing: [...missing].sort(),
  };
}

export interface MonthBar {
  month: string;
  dueMinor: number;
  paidMinor: number;
  /** Items due this month still unpaid and past their day. */
  late: number;
  allPaid: boolean;
  soFar: boolean;
  nothingDue: boolean;
}

/** Due and paid per month (debts only), each in the base currency; the current month is "so far". */
export function monthBars(byMonth: Readonly<Record<string, readonly PlanItem[]>>, months: readonly string[], today: string): MonthBar[] {
  const current = monthOf(today);
  return months.map((month) => {
    const due = (byMonth[month] ?? []).filter((i) => monthOf(i.dueOn) === month && i.inTotals !== false);
    const sum = (list: readonly PlanItem[], pick: (i: PlanItem) => number | null) => list.reduce((total, i) => total + (pick(i) ?? 0), 0);
    const paid = due.filter((i) => i.status === 'paid');
    const late = due.filter((i) => i.status === 'late').length;
    return {
      month,
      dueMinor: sum(due, dueFigure),
      paidMinor: sum(due, paidFigure),
      late,
      allPaid: due.length > 0 && paid.length === due.length,
      soFar: month === current,
      nothingDue: due.length === 0,
    };
  });
}

/** The month line's tag: "All paid" | "1 late" | "Nothing due"; empty while a month is still running with nothing late. */
export function monthTag(bar: MonthBar): string {
  if (bar.late > 0) return `${bar.late} late`;
  if (bar.allPaid) return 'All paid';
  if (bar.nothingDue) return 'Nothing due';
  return '';
}
