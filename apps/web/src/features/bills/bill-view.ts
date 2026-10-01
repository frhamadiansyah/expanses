import { billPill, type BillTone, dayMonth, minorToMajorString, monthName, monthYear } from '@expanses/core';
import type { BookMoney, MonthlyBill } from '@expanses/db';
import type { Tone } from '../../ui/native/row';
import type { UnconvertedRow } from '../workspaces/Unconverted';

export const isSettled = (bill: MonthlyBill) => bill.state === 'paid' || bill.state === 'skipped';
/** A bill whose month is paused: nothing comes out, so it is neither owed nor counted. */
export const isPaused = (bill: Pick<MonthlyBill, 'state'>) => bill.state === 'paused';
/** A bill still to pay this month: not settled, not paused. */
export const isToPay = (bill: MonthlyBill) => !isSettled(bill) && !isPaused(bill);
const isOutAndUnpaid = (bill: MonthlyBill) => bill.state === 'overdue' || bill.state === 'dueSoon' || bill.state === 'open';

/** What a row is worth in a total: what it came to once paid, else its amount, else the estimate. */
export const amountOf = (bill: MonthlyBill) => (bill.state === 'paid' ? (bill.paidMinor ?? 0) : (bill.amountMinor ?? bill.estimateMinor ?? 0));

export const variesWords = (n: number) => (n === 1 ? '1 amount varies' : `${n} amounts vary`);

export interface BillSection {
  key: 'overdue' | 'dueSoon' | 'later';
  title: string;
  rows: MonthlyBill[];
}

/** The bills still to deal with, most urgent first. What is paid or skipped is folded away by `settledOf`. */
export function sectionsOf(rows: readonly MonthlyBill[]): BillSection[] {
  return [
    { key: 'overdue' as const, title: 'Overdue', rows: rows.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, title: 'Due soon', rows: rows.filter((b) => b.state === 'dueSoon') },
    { key: 'later' as const, title: 'Later', rows: rows.filter((b) => b.state === 'open' || b.state === 'upcoming') },
  ].filter((section) => section.rows.length > 0);
}

/** The bills whose month is paused, for a group of their own under the ones to pay. */
export function pausedOf(rows: readonly MonthlyBill[]): MonthlyBill[] {
  return rows.filter(isPaused);
}

export interface SettledFold {
  /** "Paid in October", or "Skipped in October", or "Paid and skipped in October" when it holds both. */
  title: string;
  count: number;
  /** What the paid ones came to; a skip costs nothing. */
  paidMinor: number;
  rows: MonthlyBill[];
}

/** The month's paid and skipped bills, folded into one row; null while there are none. */
export function settledOf(rows: readonly MonthlyBill[], today: string): SettledFold | null {
  const settled = rows.filter(isSettled);
  if (settled.length === 0) return null;
  const paid = settled.filter((b) => b.state === 'paid');
  const what = paid.length === settled.length ? 'Paid' : paid.length === 0 ? 'Skipped' : 'Paid and skipped';
  return { title: `${what} in ${monthName(today.slice(0, 7), 'long')}`, count: settled.length, paidMinor: sum(paid), rows: settled };
}

const sum = (rows: readonly MonthlyBill[]) => rows.reduce((total, b) => total + amountOf(b), 0);
const anyVaries = (rows: readonly MonthlyBill[]) => rows.some((b) => b.amountMinor === null);

export interface BillSummary {
  monthLabel: string;
  totalMinor: number;
  approximate: boolean;
  variesText: string | null;
  /** What the total is made of, for the bar and its key: only the parts with money in them. */
  parts: { key: 'overdue' | 'dueSoon' | 'later'; label: string; minor: number; approximate: boolean }[];
  allSettled: boolean;
  /** Nothing to pay because every bill is paused, which is not the same as all paid. */
  allPaused: boolean;
}

export function summaryOf(rows: readonly MonthlyBill[], today: string): BillSummary {
  const open = rows.filter(isToPay);
  const varying = open.filter((b) => b.amountMinor === null).length;
  const groups = [
    { key: 'overdue' as const, label: 'Overdue', rows: open.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, label: 'Due soon', rows: open.filter((b) => b.state === 'dueSoon') },
    { key: 'later' as const, label: 'Later', rows: open.filter((b) => b.state === 'open' || b.state === 'upcoming') },
  ];
  return {
    monthLabel: monthName(today.slice(0, 7), 'long'),
    totalMinor: sum(open),
    approximate: varying > 0,
    variesText: varying > 0 ? variesWords(varying) : null,
    parts: groups.filter((g) => sum(g.rows) > 0).map((g) => ({ key: g.key, label: g.label, minor: sum(g.rows), approximate: anyVaries(g.rows) })),
    allSettled: open.length === 0,
    allPaused: open.length === 0 && rows.length > 0 && rows.every(isPaused),
  };
}

/**
 * Every bill in the currency the workspace reads in, so a total can add them up.
 *
 * A bill's amount is in the money of the account that pays it, and a workspace may be paid from accounts in
 * several currencies: added up raw, a dollar bill and a rupiah bill would make a figure that means nothing. Each
 * is converted from the payer's currency at the rate on the day the bill comes out — the day the money leaves —
 * and one no rate reaches counts as nothing and is named, rather than being added in as the wrong money.
 *
 * A workspace reading in the owner's own currency converts nothing and gets its rows back untouched.
 */
export function billsInReadCurrency(
  rows: readonly MonthlyBill[],
  money: BookMoney | undefined,
  currencyOf: (bill: MonthlyBill) => string,
): { rows: MonthlyBill[]; unconverted: UnconvertedRow[] } {
  if (!money?.converts) return { rows: [...rows], unconverted: [] };
  const missed = new Map<string, string>();
  const converted = rows.map((bill) => {
    const from = currencyOf(bill);
    const onDate = bill.window.opensOn;
    const at = (minor: number | null) => {
      if (minor === null) return null;
      const value = money.convert(minor, from, onDate);
      if (value === null) {
        const earliest = missed.get(from);
        if (!earliest || onDate < earliest) missed.set(from, onDate);
      }
      return value ?? 0;
    };
    return { ...bill, amountMinor: at(bill.amountMinor), paidMinor: at(bill.paidMinor), estimateMinor: at(bill.estimateMinor) };
  });
  return { rows: converted, unconverted: [...missed].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency)) };
}

/** What the Cashflow card calls owed: every bill that is out and unpaid. */
export function owedNow(rows: readonly MonthlyBill[]): { minor: number; approximate: boolean } {
  const out = rows.filter(isOutAndUnpaid);
  return { minor: sum(out), approximate: anyVaries(out) };
}

export function sublineOf(bill: MonthlyBill, accountName: string, today: string): string {
  return bill.billMonth < today.slice(0, 7) ? `${monthName(bill.billMonth, 'short')} bill · ${accountName}` : accountName;
}

/** Each tone as a capsule on its own tinted ground, from the kit's panel tokens so a dark screen gets a dark pill. */
export const PILL_CLASS: Record<BillTone, string> = {
  grey: 'bg-[var(--ph-fill)] text-[var(--ph-ink-3)]',
  blue: 'bg-[var(--ph-info-panel)] text-[var(--ph-info-ink)]',
  amber: 'bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]',
  red: 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm-ink)]',
  green: 'bg-[var(--ph-tint-panel)] text-[var(--ph-tint-ink)]',
};

export function pillOf(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn'>): { text: string; className: string } {
  const pill = billPill({ state: bill.state, days: bill.days }, bill.window, bill.paidOn);
  return { text: pill.text, className: PILL_CLASS[pill.tone] };
}

/**
 * The small line under a row's amount: how late, how soon, or the day it is due — the same states the pill names,
 * in fewer words. Late in alarm, soon in warning, the rest quiet.
 */
export function statusOf(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn' | 'pausedUntil'>): { text: string; tone: Tone } {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  switch (bill.state) {
    case 'overdue':
      return { text: `${days(bill.days)} late`, tone: 'alarm' };
    case 'dueSoon':
      return { text: bill.days === 0 ? 'due today' : `in ${days(bill.days)}`, tone: 'warn' };
    case 'open':
      return { text: dayMonth(bill.window.payBy), tone: 'ink-3' };
    case 'upcoming':
      // A bill that comes out before it is due says when it comes out; one due the day it comes out, just the day.
      return { text: bill.window.opensOn === bill.window.payBy ? dayMonth(bill.window.payBy) : `Opens ${dayMonth(bill.window.opensOn)}`, tone: 'ink-3' };
    case 'paid':
      return { text: bill.paidOn ? `Paid ${dayMonth(bill.paidOn)}` : 'Paid', tone: 'tint' };
    case 'skipped':
      return { text: 'Skipped', tone: 'ink-3' };
    case 'paused':
      return { text: bill.pausedUntil ? `until ${monthYear(bill.pausedUntil)}` : 'Paused', tone: 'ink-3' };
  }
}

/**
 * A bill's amount as it goes into a form field, in the currency of the account that pays it — the currency it is
 * parsed back in on save, so a USD bill of 1500 minor reads 15.00 and saves as 15.00. Empty when the amount varies.
 */
export function amountInput(amountMinor: number | null, currency: string): string {
  return amountMinor === null ? '' : minorToMajorString(amountMinor, currency);
}

/** The toast after recording: the bill by name when there was one, else how many. */
export function paidText(names: readonly string[]): string {
  return names.length === 1 ? `Paid ${names[0]}` : `Paid ${names.length} bills`;
}

/** The toast after a skip. Last month's or next month's bill is named, so the skip is not mistaken for this month's. */
export function skippedText(name: string, month: string, today: string): string {
  return month === today.slice(0, 7) ? `Skipped ${name} this month` : `Skipped ${name}’s ${monthName(month, 'long')} bill`;
}
