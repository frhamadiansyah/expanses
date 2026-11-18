import { addMonths, BILL_DUE_SOON_DAYS, currencyInfo, daysFrom, dayMonth, monthName, monthYear } from '@expanses/core';
import type { BillMonthRow, MonthlyBill } from '@expanses/db';
import { compactMoney } from '../../app/sidebar-model';
import type { Tone } from '../../ui/native/row';
import { amountOf, isDueSoon, isPaused, isToPay, summaryOf } from './bill-view';

export { isDueSoon };

/*
 * Bills on a wide screen (Mac Bills, "List + calendar together", owner 2026-11-17): the month calendar's days and marks,
 * the month's box, the bars of bills each month, and the table's groups. Every figure is the phone's — `summaryOf` and
 * the same paid / to pay / paused rules — so the box, the bars and the groups under them always agree.
 */

/** A month's bill read by `billsInMonth` (any month), shaped as the list's own rows: nothing to pay ahead, no pause asked. */
export function asMonthlyBill(row: BillMonthRow): MonthlyBill {
  const { bill, month, payments: _payments, estimateMinor, ...standing } = row;
  return {
    ...bill,
    billMonth: month,
    ...standing,
    estimateMinor,
    payableMonths: [],
    pausedUntil: null,
    pauseFrom: month,
  };
}

/** The day a bill is due by: what the table's Due says and where the calendar marks it. */
export const dueOf = (bill: Pick<MonthlyBill, 'window'>) => bill.window.payBy;

/**
 * The grey note on a row due after the month it is counted in — a yearly bill listed in the weeks before its date, or a
 * bill paid by a day in the next month: "due 5 Dec · counted in Nov". The phone counts it in this month too.
 */
export function countedNote(bill: Pick<MonthlyBill, 'window' | 'state'>, month: string): string | null {
  const due = dueOf(bill);
  if (bill.state === 'paused' || due.slice(0, 7) <= month) return null;
  return `due ${dayMonth(due)} · counted in ${monthName(month, 'short')}`;
}

// ── The calendar ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CalendarDay {
  date: string;
  day: number;
  /** False for the days of the month before and after that fill the first and last week, drawn faint as Mac Calendar's. */
  inMonth: boolean;
}

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The month in whole weeks, Monday first (the app has no week-start setting): 4 to 6 rows of 7 days. */
export function calendarWeeks(month: string): CalendarDay[][] {
  const first = Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells; i++) {
    const date = iso(first + (i - lead) * 86_400_000);
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1)!.push({
      date,
      day: Number(date.slice(8, 10)),
      inMonth: date.slice(0, 7) === month,
    });
  }
  return weeks;
}

/**
 * A day's mark under its number: `soon` (orange) for a bill late or due soon (`isDueSoon` — the table's Due soon, the
 * sidebar's count), `later` (grey) for one still to come, `paid` (a hollow ring) for one already paid. Skipped and paused
 * bills come out for nothing and leave no mark. The most pressing bill of the day sets it.
 */
export type DayMark = 'soon' | 'later' | 'paid';

function markOf(bill: Pick<MonthlyBill, 'state' | 'window'>, today: string): DayMark | null {
  if (isDueSoon(bill, today)) return 'soon';
  if (bill.state === 'open' || bill.state === 'upcoming') return 'later';
  if (bill.state === 'paid') return 'paid';
  return null;
}

const RANK: Record<DayMark, number> = { soon: 3, later: 2, paid: 1 };

export function dayMarks(rows: readonly Pick<MonthlyBill, 'state' | 'window'>[], today: string): Map<string, DayMark> {
  const marks = new Map<string, DayMark>();
  for (const bill of rows) {
    const mark = markOf(bill, today);
    if (!mark) continue;
    const day = dueOf(bill);
    const was = marks.get(day);
    if (!was || RANK[mark] > RANK[was]) marks.set(day, mark);
  }
  return marks;
}

/** The bills due on one day, as the table lists them. */
export function billsOn<T extends Pick<MonthlyBill, 'window'>>(rows: readonly T[], date: string): T[] {
  return rows.filter((bill) => dueOf(bill) === date);
}

// ── The table ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type DeskGroupKey = 'dueSoon' | 'later' | 'paid' | 'paused';

export interface DeskGroup<T> {
  key: DeskGroupKey;
  title: string;
  rows: T[];
}

/**
 * The table's groups: Due soon is what is late or due within the phone's few days (`isDueSoon`), Later is every other
 * bill still to pay, Paid holds what is paid or skipped (the phone's Paid group), and Paused what comes out for nothing.
 * Left to pay in the month's box is exactly Due soon and Later added up. A card's annual fee is none of these: it has a
 * read-only Card fees group of its own, in no total.
 */
export function deskGroups<T extends Pick<MonthlyBill, 'state' | 'window'>>(rows: readonly T[], month: string, current: boolean, today: string): DeskGroup<T>[] {
  const name = monthName(month, 'long');
  const soon = (b: T) => isDueSoon(b, today);
  const later = rows.filter((b) => (b.state === 'open' || b.state === 'upcoming') && !soon(b));
  // A yearly bill is listed in the weeks before its date, which may be next month's: then the group is plain Later.
  const within = later.every((b) => dueOf(b).slice(0, 7) <= month);
  return [
    { key: 'dueSoon' as const, title: 'Due soon', rows: rows.filter(soon) },
    {
      key: 'later' as const,
      title: !within ? 'Later' : current ? 'Later this month' : `Later in ${name}`,
      rows: later,
    },
    {
      key: 'paid' as const,
      title: current ? 'Paid this month' : `Paid in ${name}`,
      rows: rows.filter((b) => b.state === 'paid' || b.state === 'skipped'),
    },
    { key: 'paused' as const, title: 'Paused', rows: rows.filter(isPaused) },
  ].filter((group) => group.rows.length > 0);
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * The Status column: "Due in 2 days" (warning) or "Due today", "3 days late" (alarm), "In 12 days" (quiet, counted to
 * the day it is due), "Paid 2 Dec" (green), "Skipped", "Paused until Jan 2027". A bill under Due soon (`isDueSoon`)
 * always reads "Due in n days" in warning, out yet or not.
 */
export function deskStatus(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn' | 'pausedUntil'>, today: string): { text: string; tone: Tone } {
  switch (bill.state) {
    case 'overdue':
      return { text: `${days(bill.days)} late`, tone: 'alarm' };
    case 'dueSoon':
      return {
        text: bill.days === 0 ? 'Due today' : `Due in ${days(bill.days)}`,
        tone: 'warn',
      };
    case 'open':
    case 'upcoming': {
      const left = daysFrom(today, dueOf(bill));
      if (left <= BILL_DUE_SOON_DAYS) return { text: left <= 0 ? 'Due today' : `Due in ${days(left)}`, tone: 'warn' };
      return { text: `In ${days(left)}`, tone: 'ink-3' };
    }
    case 'paid':
      return {
        text: bill.paidOn ? `Paid ${dayMonth(bill.paidOn)}` : 'Paid',
        tone: 'gain',
      };
    case 'skipped':
      return { text: 'Skipped', tone: 'ink-3' };
    case 'paused':
      return {
        text: bill.pausedUntil ? `Paused until ${monthYear(bill.pausedUntil)}` : 'Paused',
        tone: 'ink-3',
      };
  }
}

// ── The month's box ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface MonthBox {
  /** Still to pay: Due soon and Later added up (`summaryOf`'s total). */
  leftMinor: number;
  paidMinor: number;
  /** Paid and still to pay together: the month's whole bill, and the hatched bar's figure. */
  totalMinor: number;
  paidCount: number;
  /** The bills that count: paid and still to pay. Skipped and paused ones come to nothing. */
  count: number;
  /** A bill still to pay has no fixed amount: its estimate stands in. */
  approximate: boolean;
  allPaid: boolean;
  allPaused: boolean;
}

export function monthBoxOf(rows: readonly MonthlyBill[], today: string, monthStart = 1): MonthBox {
  const summary = summaryOf(rows, today, monthStart);
  const paidCount = rows.filter((bill) => bill.state === 'paid').length;
  return {
    leftMinor: summary.totalMinor,
    paidMinor: summary.paidMinor,
    totalMinor: summary.monthTotalMinor,
    paidCount,
    count: paidCount + rows.filter(isToPay).length,
    approximate: summary.approximate,
    allPaid: rows.length > 0 && summary.allSettled && !summary.allPaused,
    allPaused: summary.allPaused,
  };
}

/** What the ticked bills add up to, in the reading money; `approximate` when one of them varies. */
export function pickedTotal(rows: readonly MonthlyBill[], picked: ReadonlySet<string>): { minor: number; approximate: boolean } {
  const chosen = rows.filter((bill) => picked.has(bill.id) && isToPay(bill));
  return {
    minor: chosen.reduce((sum, bill) => sum + amountOf(bill), 0),
    approximate: chosen.some((bill) => bill.amountMinor === null),
  };
}

// ── Bills each month ────────────────────────────────────────────────────────────────────────────────────────────────

export interface MonthBar {
  month: string;
  minor: number;
  /** This month or one ahead: what is expected (paid and still to pay), hatched; a month gone by is what was paid. */
  expected: boolean;
}

/** The months the bars show: the five before `month`, then `month`. */
export const barMonths = (month: string) => [-5, -4, -3, -2, -1, 0].map((by) => addMonths(month, by));

/** One month's bar, read with the month box's own rule: a month gone by is its Paid, this month or later its whole bill. */
export function monthBarOf(month: string, rows: readonly MonthlyBill[], current: string, today: string, monthStart = 1): MonthBar {
  const box = monthBoxOf(rows, today, monthStart);
  const expected = month >= current;
  return { month, minor: expected ? box.totalMinor : box.paidMinor, expected };
}

/** A short figure with its money's symbol: compactMoney's "10,2 jt" as "Rp 10,2 jt"; one that has it already as it is. */
export function compactWithSymbol(minor: number, currency: string): string {
  const text = compactMoney(minor, currency);
  return /^−?\d/.test(text) ? text.replace(/^(−?)/, `$1${currencyInfo(currency).symbol}\u00a0`) : text;
}

/**
 * The plain line under the bars (owner, 18 Nov 2026), no percentage: "November: Rp 10,2 jt due · October paid
 * Rp 3,4 jt". A month still to come (or this one) is what is due, paid and to pay; a month gone by what was paid. Null
 * with fewer than two bars.
 */
export function trendCaption(bars: readonly MonthBar[], currency: string): string | null {
  const last = bars.at(-1);
  const before = bars.at(-2);
  if (!last || !before) return null;
  const lead = `${monthName(last.month, 'long')}: ${compactWithSymbol(last.minor, currency)} ${last.expected ? 'due' : 'paid'}`;
  return `${lead} · ${monthName(before.month, 'long')} ${before.expected ? 'due' : 'paid'} ${compactWithSymbol(before.minor, currency)}`;
}

/** The bars' scale: rupiah in millions ("jt") or thousands ("rb"), any other money in whole units of it. */
export function barScale(maxMinor: number, currency: string): { unit: string; label: (minor: number) => string } {
  const exponent = currencyInfo(currency).exponent;
  const major = (minor: number) => minor / 10 ** exponent;
  const fmt = (value: number, digits: number) => value.toLocaleString('id-ID', { maximumFractionDigits: digits });
  if (currency === 'IDR' && major(maxMinor) >= 1e6) return { unit: 'jt', label: (minor) => fmt(major(minor) / 1e6, 1) };
  if (currency === 'IDR') return { unit: 'rb', label: (minor) => fmt(major(minor) / 1e3, 0) };
  return { unit: currency, label: (minor) => fmt(major(minor), 0) };
}
