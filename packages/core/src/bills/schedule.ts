import { addMonths, monthOf, monthRange } from '../reports/periods';

/** How many days before its pay-by day a bill turns amber. */
export const BILL_DUE_SOON_DAYS = 3;

export type BillStateKind = 'upcoming' | 'open' | 'dueSoon' | 'overdue' | 'paid' | 'skipped' | 'paused';
/** How a month was dealt with. A paused month was set aside ahead of time: no bill comes out for it. */
export type BillSettlement = 'paid' | 'skipped' | 'paused' | null;
export type BillTone = 'grey' | 'blue' | 'amber' | 'red' | 'green';

/** One month's bill: the day it comes out and the day it must be paid by. */
export interface BillWindow {
  /** YYYY-MM: the month the bill belongs to, which is the month it comes out. */
  month: string;
  opensOn: string;
  payBy: string;
}

export interface BillStanding {
  state: BillStateKind;
  /** Days until it opens (upcoming), days left (open, dueSoon), days late (overdue); 0 when settled. */
  days: number;
}

export interface BillMonthsInput {
  today: string;
  /** The first month this bill can be owed for. */
  startsMonth: string;
  outDay: number;
  payByDay: number | null;
  /** Months already dealt with, or paused. */
  settled: Readonly<Record<string, 'paid' | 'skipped' | 'paused'>>;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A day of a month, or the month's last day when it is shorter. */
function dayIn(month: string, day: number): string {
  const last = Number(monthRange(month).to.slice(8, 10));
  return `${month}-${pad(Math.min(day, last))}`;
}

const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** Whole days from one YYYY-MM-DD to another; negative when `to` is earlier. */
export function daysFrom(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * A pay-by day earlier than the out day belongs to the following month: out on the 28th, pay by the 5th. With no
 * pay-by day the bill is due the day it comes out, which is how bills behaved before they had one.
 */
export function billWindow(month: string, outDay: number, payByDay: number | null): BillWindow {
  const opensOn = dayIn(month, outDay);
  if (payByDay === null) return { month, opensOn, payBy: opensOn };
  const payBy = payByDay >= outDay ? dayIn(month, payByDay) : dayIn(addMonths(month, 1), payByDay);
  return { month, opensOn, payBy };
}

/** Where one month's bill stands on a day. Settled first, then not out yet, then late, then how close. */
export function billStanding(window: BillWindow, today: string, settled: BillSettlement): BillStanding {
  if (settled === 'paid') return { state: 'paid', days: 0 };
  if (settled === 'skipped') return { state: 'skipped', days: 0 };
  if (settled === 'paused') return { state: 'paused', days: 0 };
  if (today < window.opensOn) return { state: 'upcoming', days: daysFrom(today, window.opensOn) };
  const left = daysFrom(today, window.payBy);
  if (left < 0) return { state: 'overdue', days: -left };
  if (left <= BILL_DUE_SOON_DAYS) return { state: 'dueSoon', days: left };
  return { state: 'open', days: left };
}

/**
 * The month a bill's row speaks for today: last month while that is still unsettled (it has always come out by now),
 * otherwise this month. One month back only, and never before the bill was tracked.
 */
export function currentBillMonth({ today, startsMonth, settled }: BillMonthsInput): string {
  const month = monthOf(today);
  const previous = addMonths(month, -1);
  return previous >= startsMonth && !settled[previous] ? previous : month;
}

/**
 * Months a payment can be recorded for, oldest first; the first is the default. A paused month can still be paid on
 * purpose, so it is offered too — after every month that is owed, so it is never the one picked for a payment.
 */
export function payableBillMonths({ today, startsMonth, settled }: BillMonthsInput): string[] {
  const month = monthOf(today);
  const open = [addMonths(month, -1), month, addMonths(month, 1)].filter((m) => m >= startsMonth && settled[m] !== 'paid' && settled[m] !== 'skipped');
  return [...open.filter((m) => settled[m] !== 'paused'), ...open.filter((m) => settled[m] === 'paused')];
}

/** The months a pause covers: from its first month up to, not including, the month the bill comes back. */
export function pausedMonths(from: string, until: string): string[] {
  const months: string[] = [];
  for (let month = from; month < until; month = addMonths(month, 1)) months.push(month);
  return months;
}

/**
 * The first month a pause starting today would cover: this month, unless it is already paid or skipped, in which
 * case the next month that is not. Last month's bill, if still owed, stays owed: a pause looks ahead.
 */
export function pauseStart(today: string, settled: Readonly<Record<string, 'paid' | 'skipped' | 'paused'>>): string {
  let month = monthOf(today);
  while (settled[month] === 'paid' || settled[month] === 'skipped') month = addMonths(month, 1);
  return month;
}

/**
 * The month a paused bill comes back: the month after the last paused month from this one on. Null when nothing from
 * this month on is paused, so a pause ends by itself once its months are past — nothing has to clear it.
 */
export function pausedUntil(paused: Iterable<string>, today: string): string | null {
  const month = monthOf(today);
  let last: string | null = null;
  for (const m of paused) if (m >= month && (last === null || m > last)) last = m;
  return last === null ? null : addMonths(last, 1);
}

/** "Jan 2027": the short way a month is named under an amount. */
export function monthYear(month: string): string {
  return `${monthName(month, 'short')} ${month.slice(0, 4)}`;
}

export function monthName(month: string, width: 'long' | 'short'): string {
  const name = MONTHS_LONG[Number(month.slice(5, 7)) - 1]!;
  return width === 'long' ? name : name.slice(0, 3);
}

/** "8 Sep". */
export function dayMonth(date: string): string {
  return `${Number(date.slice(8, 10))} ${monthName(date.slice(0, 7), 'short')}`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/** "Every month · out on the 28th · pay by the 5th". */
export function billSchedule(outDay: number, payByDay: number | null): string {
  return `Every month · out on the ${ordinal(outDay)}${payByDay === null ? '' : ` · pay by the ${ordinal(payByDay)}`}`;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The state pill's words and colour. */
export function billPill(standing: BillStanding, window: BillWindow, paidOn: string | null): { text: string; tone: BillTone } {
  switch (standing.state) {
    case 'upcoming':
      return { text: `Opens ${dayMonth(window.opensOn)}`, tone: 'grey' };
    case 'open':
      return { text: `Pay by ${dayMonth(window.payBy)}`, tone: 'blue' };
    case 'dueSoon':
      return { text: standing.days === 0 ? 'Due today' : `Due in ${plural(standing.days, 'day')}`, tone: 'amber' };
    case 'overdue':
      return { text: `Overdue ${plural(standing.days, 'day')}`, tone: 'red' };
    case 'paid':
      return { text: paidOn ? `✓ Paid ${dayMonth(paidOn)}` : '✓ Paid', tone: 'green' };
    case 'skipped':
      return { text: 'Skipped', tone: 'grey' };
    case 'paused':
      return { text: 'Paused', tone: 'grey' };
  }
}
