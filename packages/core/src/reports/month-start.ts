import { addMonths, daysInMonth } from './periods';

/*
 * "Month starts on" (owner, 16 Nov 2026): a workspace's months may begin on payday rather than on the 1st. Every page
 * that groups or totals by month — Cashflow, Budget, Essential · Lifestyle · Debts & savings, the bills of "this
 * month", Financial health, the reports — asks these two functions which days a month covers and which month a day is
 * in, so they all agree. Nothing stored changes: a transaction keeps its date, a bill its day and its bill month, a
 * card its statement cycle, a loan its schedule. The setting only regroups.
 *
 * The start day is 1 to 28, or `MONTH_START_LAST` for the last day of the month. With 1 a month is the calendar month,
 * exactly as before the setting existed.
 *
 * A month is named after the month most of it falls in. Starting on the 2nd to the 15th, "November" begins in
 * November (5 Nov – 4 Dec); starting on the 16th or later, or on the last day, it ends in November (25 Oct – 24 Nov).
 * Each month runs to the day before the next one starts, so the months never overlap and never leave a gap, and a day
 * past a short month's end is that month's last day: "Last day" makes November 31 Oct – 29 Nov, March 28 Feb – 30 Mar.
 */

/** The value kept for "Last day of the month". */
export const MONTH_START_LAST = 31;

/** 1–28, or `MONTH_START_LAST`. */
export type MonthStartDay = number;

/** Starting on this day or later, a month is named after the month it ends in. */
const NAMED_BY_END_FROM = 16;

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whether a value is a start day this app offers. */
export function isMonthStartDay(value: unknown): value is MonthStartDay {
  return typeof value === 'number' && Number.isInteger(value) && ((value >= 1 && value <= 28) || value === MONTH_START_LAST);
}

/** A kept or synced start day as the app reads it: anything it does not offer is the 1st, the calendar month. */
export function monthStartOf(value: unknown): MonthStartDay {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return isMonthStartDay(n) ? n : 1;
}

/** The start day in a calendar month: the month's last day when the month is shorter. */
function startIn(calendarMonth: string, startDay: MonthStartDay): string {
  const [y, m] = calendarMonth.split('-').map(Number) as [number, number];
  return `${calendarMonth}-${pad(Math.min(startDay, daysInMonth(y, m)))}`;
}

/** The day before a YYYY-MM-DD date. */
function dayBefore(date: string): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) - 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The calendar month a named month's first day is in: its own, or the one before for a month named by its end. */
const startMonthOf = (month: string, startDay: MonthStartDay) => (startDay >= NAMED_BY_END_FROM ? addMonths(month, -1) : month);

/** The first day of a named month. */
function firstDay(month: string, startDay: MonthStartDay): string {
  return startIn(startMonthOf(month, startDay), startDay);
}

/**
 * The days a YYYY-MM month covers, both inclusive, for a workspace whose months start on `startDay`. With 1 it is the
 * calendar month. A start day this app does not offer is read as 1.
 */
export function monthPeriod(month: string, startDay: MonthStartDay = 1): { from: string; to: string } {
  const day = monthStartOf(startDay);
  if (day === 1) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(y, m))}` };
  }
  return { from: firstDay(month, day), to: dayBefore(firstDay(addMonths(month, 1), day)) };
}

/** The YYYY-MM month a YYYY-MM-DD day is counted in, for a workspace whose months start on `startDay`. */
export function periodMonthOf(date: string, startDay: MonthStartDay = 1): string {
  const day = monthStartOf(startDay);
  const calendar = date.slice(0, 7);
  if (day === 1) return calendar;
  // The named month whose first day is in this calendar month, and whether the day is on or after it.
  const startingHere = day >= NAMED_BY_END_FROM ? addMonths(calendar, 1) : calendar;
  return date >= startIn(calendar, day) ? startingHere : addMonths(startingHere, -1);
}

/** "25 Oct – 24 Nov": the days a month covers, for the setting's footer. */
export function monthPeriodDates(month: string, startDay: MonthStartDay = 1): string {
  const { from, to } = monthPeriod(month, startDay);
  const short = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]}`;
  return `${short(from)} – ${short(to)}`;
}

/** "1st", "25th", "Last day": the start day as the setting's row says it. */
export function monthStartLabel(startDay: MonthStartDay): string {
  const day = monthStartOf(startDay);
  if (day === MONTH_START_LAST) return 'Last day';
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

/**
 * The calendar month (a bill month) of the occurrence of a day-of-month that falls inside a named month: a bill out
 * on the 27th counts in "November" (25 Oct – 24 Nov) by its 27 October bill. The bill keeps its day and its months;
 * only which of them is "this month's" moves. With 1 it is the named month itself. When no occurrence falls inside
 * (a bill on the 30th in a month from 31 Oct to 29 Nov), the first one after it.
 */
export function billMonthIn(month: string, outDay: number, startDay: MonthStartDay = 1): string {
  const day = monthStartOf(startDay);
  if (day === 1) return month;
  const { from } = monthPeriod(month, day);
  const calendar = from.slice(0, 7);
  return startIn(calendar, outDay) >= from ? calendar : addMonths(calendar, 1);
}
