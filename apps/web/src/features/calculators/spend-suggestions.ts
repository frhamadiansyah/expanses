import { addMonths, daysInMonth, monthOf } from '@expanses/core';

/** One month of a period's flows, as `periodFlows` reports it. */
export interface MonthFigures {
  month: string;
  incomeMinor: number;
  spendingMinor: number;
  debtPaymentsMinor: number;
}

/** What one range of `periodFlows` gives the bar: its monthly rows, and the total the page counts as "what goes out". */
export interface RangeFigures {
  byMonth: readonly MonthFigures[];
  totalMinor: number;
}

export interface SpendRange {
  from: string;
  to: string;
}

export interface SpendRanges {
  lastMonth: SpendRange;
  last3: SpendRange;
  /** From 1 January to today. */
  ytd: SpendRange;
  /** The twelve months to today, as the Income page reads them. */
  last12: SpendRange;
}

export interface SpendSuggestion {
  key: string;
  caption: string;
  minor: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (month: string) => `${month}-${pad(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))))}`;

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The four ranges the bars read, for a day: full calendar months for "last month" and the 3-month average. */
export function spendRanges(today: string): SpendRanges {
  const thisMonth = monthOf(today);
  const lastMonth = addMonths(thisMonth, -1);
  return {
    lastMonth: { from: `${lastMonth}-01`, to: lastDayOf(lastMonth) },
    last3: { from: `${addMonths(thisMonth, -3)}-01`, to: lastDayOf(lastMonth) },
    ytd: { from: `${thisMonth.slice(0, 4)}-01-01`, to: today },
    last12: { from: shiftDays(today, -364), to: today },
  };
}

const hasFlow = (m: MonthFigures) => m.incomeMinor !== 0 || m.spendingMinor !== 0 || m.debtPaymentsMinor !== 0;

/** Total over the months that had any cash flow, divided by how many of them there were; null with none or nothing spent. */
export function monthlyAverage(range: RangeFigures | undefined): number | null {
  if (!range) return null;
  const months = range.byMonth.filter(hasFlow).length;
  if (months === 0 || range.totalMinor <= 0) return null;
  return Math.round(range.totalMinor / months);
}

/**
 * The year so far, monthly: from 1 January or the first month with a transaction, to today. The month under way counts
 * for the part of it that has passed, so a quiet first week does not pull the average down.
 */
export function averageSoFar(range: RangeFigures | undefined, today: string): number | null {
  if (!range || range.totalMinor <= 0) return null;
  const first = range.byMonth.find(hasFlow);
  if (!first) return null;
  const thisMonth = monthOf(today);
  const [fy, fm] = first.month.split('-').map(Number) as [number, number];
  const [ty, tm] = thisMonth.split('-').map(Number) as [number, number];
  const whole = (ty - fy) * 12 + (tm - fm);
  const share = Number(today.slice(8, 10)) / daysInMonth(ty, tm);
  const months = whole + share;
  return months > 0 ? Math.round(range.totalMinor / months) : null;
}

export interface SpendData {
  lastMonth?: RangeFigures;
  last3?: RangeFigures;
  ytd?: RangeFigures;
  last12?: RangeFigures;
}

const only = (list: Array<SpendSuggestion | null>) => list.filter((s): s is SpendSuggestion => s !== null && s.minor > 0);
const make = (key: string, caption: string, minor: number | null): SpendSuggestion | null => (minor === null ? null : { key, caption, minor });

/** Emergency fund: last month, the 3-month average, the year so far — each monthly. Ones with no data are left out. */
export function emergencySuggestions(data: SpendData, today: string): SpendSuggestion[] {
  const lastMonth = data.lastMonth && data.lastMonth.totalMinor > 0 && data.lastMonth.byMonth.some(hasFlow) ? Math.round(data.lastMonth.totalMinor) : null;
  return only([make('last', 'Last month', lastMonth), make('avg3', '3-month average', monthlyAverage(data.last3)), make('ytd', 'Average so far', averageSoFar(data.ytd, today))]);
}

/** Retirement: a year of spending three ways — the last 12 months, last month times 12, the year so far times 12. */
export function retirementSuggestions(data: SpendData, today: string): SpendSuggestion[] {
  const lastMonth = data.lastMonth && data.lastMonth.totalMinor > 0 && data.lastMonth.byMonth.some(hasFlow) ? Math.round(data.lastMonth.totalMinor) * 12 : null;
  const ytd = averageSoFar(data.ytd, today);
  const year = data.last12 && data.last12.totalMinor > 0 && data.last12.byMonth.some(hasFlow) ? Math.round(data.last12.totalMinor) : null;
  return only([make('last12', 'Last 12 months', year), make('last1x12', 'Last month × 12', lastMonth), make('ytdx12', 'Average so far × 12', ytd === null ? null : ytd * 12)]);
}
