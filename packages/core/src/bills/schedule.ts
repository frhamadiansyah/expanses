import { billMonthIn, type MonthStartDay, periodMonthOf } from '../reports/month-start';
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
  /**
   * 1-12 for a bill that is not monthly: the month of the year a yearly bill comes out, or the month the first
   * occurrence of an every-few-months bill falls in. Absent or null: owed every month.
   */
  yearlyMonth?: number | null;
  /** Months between occurrences of a bill that comes out every few months (2-11); null or 12 for a yearly one. */
  repeatEvery?: number | null;
  /**
   * The workspace's "Month starts on" (`month-start.ts`). The bill keeps its day and its bill months; "this month's"
   * bill is the one whose day falls inside this month's dates. Absent or 1: the calendar month, as always.
   */
  startDay?: MonthStartDay;
}

/**
 * The bill month that speaks for this month on `today`: the calendar month, or — for a workspace whose months start on
 * another day — the month of the occurrence whose day falls inside this month's dates.
 */
export function thisBillMonth(today: string, outDay: number, startDay: MonthStartDay = 1): string {
  return startDay === 1 ? monthOf(today) : billMonthIn(periodMonthOf(today, startDay), outDay, startDay);
}

export type BillRepeat = 'monthly' | 'yearly' | 'months';

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/**
 * Whether a bill is owed in `month`. `yearlyMonth` null: monthly, every month. A yearly bill (`every` null or 12) is
 * owed in that month of each year. Every N months it is owed each N months counted from its first occurrence
 * (`startsMonth`), which wraps over the year end whether or not N divides twelve.
 */
export function isOwedMonth(month: string, yearlyMonth: number | null | undefined, every?: number | null, startsMonth?: string): boolean {
  if (yearlyMonth == null) return true;
  if (every == null || every === 12) return Number(month.slice(5, 7)) === yearlyMonth;
  const anchor = startsMonth ?? `${month.slice(0, 4)}-${pad(yearlyMonth)}`;
  return (((monthIndex(month) - monthIndex(anchor)) % every) + every) % every === 0;
}

/** The first month on or after `from` that a bill with this schedule is owed in. */
export function nextOwedMonth(from: string, yearlyMonth: number, every?: number | null, startsMonth?: string): string {
  if (every == null || every === 12) {
    const year = Number(from.slice(0, 4));
    const month = Number(from.slice(5, 7));
    return `${month <= yearlyMonth ? year : year + 1}-${pad(yearlyMonth)}`;
  }
  let month = startsMonth && from < startsMonth ? startsMonth : from;
  for (let i = 0; i < every; i += 1, month = addMonths(month, 1)) if (isOwedMonth(month, yearlyMonth, every, startsMonth)) return month;
  return month;
}

/**
 * The month of the next occurrence of a bill made or edited today, on or after today: this one when its day has not
 * passed yet. For an every-few-months bill with a known first month, the occurrences count from it.
 */
export function nextOccurrenceMonth(today: string, yearlyMonth: number, outDay: number, every?: number | null, startsMonth?: string): string {
  if (every == null || every === 12 || !startsMonth) return firstYearlyMonth(today, yearlyMonth, outDay);
  let month = nextOwedMonth(today.slice(0, 7), yearlyMonth, every, startsMonth);
  if (dayIn(month, outDay) < today) month = nextOwedMonth(addMonths(month, 1), yearlyMonth, every, startsMonth);
  return month;
}

/**
 * The first month a yearly bill made today is owed for: the first occurrence on or after today, so a bill added after
 * its date this year starts next year instead of arriving already late.
 */
export function firstYearlyMonth(today: string, yearlyMonth: number, outDay: number): string {
  const thisYear = `${today.slice(0, 4)}-${pad(yearlyMonth)}`;
  return dayIn(thisYear, outDay) >= today ? thisYear : addMonths(thisYear, 12);
}

/** How many days ahead a yearly or periodic bill starts to show in the Recurring list. */
export const YEARLY_LIST_DAYS = 30;

/**
 * Whether a yearly bill is on the Recurring list today: out and unpaid in its month (open, due soon, overdue), or its
 * date is within 30 days. The rest of the year it is not owed and not listed; settled or paused, it has left.
 */
export function yearlyListed(standing: BillStanding, window: BillWindow, today: string): boolean {
  if (standing.state === 'overdue' || standing.state === 'dueSoon' || standing.state === 'open') return true;
  return standing.state === 'upcoming' && daysFrom(today, window.opensOn) <= YEARLY_LIST_DAYS;
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
export function currentBillMonth({ today, startsMonth, settled, yearlyMonth, repeatEvery, outDay, startDay }: BillMonthsInput): string {
  const month = thisBillMonth(today, outDay, startDay);
  const previous = addMonths(month, -1);
  if (previous >= startsMonth && !settled[previous] && isOwedMonth(previous, yearlyMonth, repeatEvery, startsMonth)) return previous;
  // A yearly bill speaks for its next occurrence: this month's when it falls in it, else the next one, never before it began.
  return yearlyMonth == null ? month : nextOwedMonth(month > startsMonth ? month : startsMonth, yearlyMonth, repeatEvery, startsMonth);
}

/**
 * Months a payment can be recorded for, oldest first; the first is the default. A paused month can still be paid on
 * purpose, so it is offered too — after every month that is owed, so it is never the one picked for a payment.
 */
export function payableBillMonths({ today, startsMonth, settled, yearlyMonth, repeatEvery, outDay, startDay }: BillMonthsInput): string[] {
  const month = thisBillMonth(today, outDay, startDay);
  const candidates =
    yearlyMonth == null
      ? [addMonths(month, -1), month, addMonths(month, 1)]
      : [...new Set([addMonths(month, -1), nextOwedMonth(month > startsMonth ? month : startsMonth, yearlyMonth, repeatEvery, startsMonth)])].filter((m) => isOwedMonth(m, yearlyMonth, repeatEvery, startsMonth));
  const open = candidates.filter((m) => m >= startsMonth && settled[m] !== 'paid' && settled[m] !== 'skipped');
  return [...open.filter((m) => settled[m] !== 'paused'), ...open.filter((m) => settled[m] === 'paused')];
}

/** The last month on or before `from` that a bill with this schedule is owed in. */
export function previousOwedMonth(from: string, yearlyMonth: number, every?: number | null, startsMonth?: string): string {
  if (every == null || every === 12) {
    const year = Number(from.slice(0, 4));
    return `${Number(from.slice(5, 7)) >= yearlyMonth ? year : year - 1}-${pad(yearlyMonth)}`;
  }
  let month = from;
  for (let i = 0; i < every; i += 1, month = addMonths(month, -1)) if (isOwedMonth(month, yearlyMonth, every, startsMonth)) return month;
  return month;
}

/**
 * The newest month a purchase may be linked to: the latest the Pay sheet offers, never before this month. A monthly
 * bill reaches next month at most. A yearly or every-few-months bill also reaches its first occurrence after this
 * month, so the next one can be paid early even while the one out now is already settled.
 */
export function latestLinkMonth(input: BillMonthsInput): string {
  const month = thisBillMonth(input.today, input.outDay, input.startDay);
  const months = [month, currentBillMonth(input), ...payableBillMonths(input)];
  if (input.yearlyMonth != null) {
    const after = addMonths(month, 1);
    months.push(nextOwedMonth(after > input.startsMonth ? after : input.startsMonth, input.yearlyMonth, input.repeatEvery, input.startsMonth));
  }
  return months.reduce((a, b) => (a > b ? a : b));
}

/**
 * The month a purchase is linked to when none is picked, and whether a tap must ask first (`ask`: the month page
 * opens instead of linking). Never a month marked paid in silence that the purchase may not be for.
 *
 * A monthly bill bought before it started: its first month, asked. With no pay-by day: the purchase's own month.
 * With one, a bill month is named by the month it comes out, so a payment on 3 Nov for the bill out 25 Oct (pay by 5 Nov) is October's: the month whose window — out day to
 * pay-by day, `billWindow` — holds the purchase date and is not settled; else the newest month already out by that
 * date when it is still owed, paid late. Otherwise — that month settled, or before the bill started — the purchase's
 * own month, asked: never an older month passed over to in silence, never one before the bill started.
 *
 * A yearly or every-few-months bill: the newest occurrence already out on the purchase date when it is still owed,
 * paid late — never a later one while an earlier one is open. Settled, the occurrence whose day is nearest the
 * purchase date: the next one, paid early (the later on a tie, and only when it can be linked yet, `latestLinkMonth`),
 * or the settled one, asked. Bought before the bill started: its first occurrence, asked.
 */
export function linkChoice(purchasedOn: string, input: BillMonthsInput): { month: string; ask: boolean } {
  const month = purchasedOn.slice(0, 7);
  if (input.yearlyMonth == null) {
    // Bought before the bill started: its first month, asked — an earlier month is linked only when chosen.
    if (month < input.startsMonth) return { month: input.startsMonth, ask: true };
    if (input.payByDay == null) return { month, ask: false };
    const open = (m: string) => m >= input.startsMonth && !input.settled[m];
    const windowOf = (m: string) => billWindow(m, input.outDay, input.payByDay);
    const months = [addMonths(month, -1), month];
    const within = months.find((m) => open(m) && windowOf(m).opensOn <= purchasedOn && purchasedOn <= windowOf(m).payBy);
    if (within) return { month: within, ask: false };
    // Paid late: the newest month out by then, and only that one — an older one is never reached past a paid month.
    const newest = [...months].reverse().find((m) => windowOf(m).opensOn <= purchasedOn);
    if (newest && open(newest)) return { month: newest, ask: false };
    return { month, ask: true };
  }
  const { yearlyMonth, repeatEvery: every, startsMonth } = input;
  // The newest occurrence already out on the purchase date, and the one after it.
  let earlier = previousOwedMonth(month, yearlyMonth, every, startsMonth);
  if (dayIn(earlier, input.outDay) > purchasedOn) earlier = previousOwedMonth(addMonths(earlier, -1), yearlyMonth, every, startsMonth);
  // Out and never paid: that one, paid late — never a later occurrence while an earlier one is open.
  if (earlier >= startsMonth && !input.settled[earlier]) return { month: earlier, ask: false };
  // Before the bill started: its first occurrence, asked — never one before it.
  if (earlier < startsMonth) return { month: nextOwedMonth(startsMonth, yearlyMonth, every, startsMonth), ask: true };
  const later = nextOwedMonth(addMonths(earlier, 1), yearlyMonth, every, startsMonth);
  if (later > latestLinkMonth(input)) return { month: earlier, ask: true };
  const away = (m: string) => Math.abs(daysFrom(purchasedOn, dayIn(m, input.outDay)));
  // Nearer the next one (or as near): paying it early, asked only when it is settled already.
  if (away(later) <= away(earlier)) return { month: later, ask: Boolean(input.settled[later]) };
  return { month: earlier, ask: true };
}

/** The months a pause covers: from its first month up to, not including, the month the bill comes back. */
export function pausedMonths(from: string, until: string): string[] {
  const months: string[] = [];
  for (let month = from; month < until; month = addMonths(month, 1)) months.push(month);
  return months;
}

/**
 * The first month a pause starting today would cover: this month, unless it is already paid or skipped, in which
 * case the next month that is not. Last month's bill, if still owed, stays owed: a pause looks ahead. `thisMonth` is
 * the bill month speaking for this month (`thisBillMonth`), the calendar month unless the workspace's months start later.
 */
export function pauseStart(today: string, settled: Readonly<Record<string, 'paid' | 'skipped' | 'paused'>>, thisMonth: string = monthOf(today)): string {
  let month = thisMonth;
  while (settled[month] === 'paid' || settled[month] === 'skipped') month = addMonths(month, 1);
  return month;
}

/**
 * The month a paused bill comes back: the month after the last paused month from this one on. Null when nothing from
 * this month on is paused, so a pause ends by itself once its months are past — nothing has to clear it. `thisMonth` as
 * for `pauseStart`.
 */
export function pausedUntil(paused: Iterable<string>, today: string, thisMonth: string = monthOf(today)): string | null {
  const month = thisMonth;
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

/** "Every year · March 12": a yearly bill's repeat, by the month and the day it comes out. */
export function yearlyRepeat(yearlyMonth: number, outDay: number): string {
  return `Every year · ${MONTHS_LONG[yearlyMonth - 1]} ${outDay}`;
}

/** "Every 3 months · from March, the 12th": an every-few-months bill's repeat, by its first month and the day. */
export function periodicRepeat(every: number, startMonth: number, outDay: number): string {
  return `Every ${every} months · from ${MONTHS_LONG[startMonth - 1]}, the ${ordinal(outDay)}`;
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
