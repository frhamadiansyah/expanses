import { billPill, type BillTone, minorToMajorString, monthName } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';

export const isSettled = (bill: MonthlyBill) => bill.state === 'paid' || bill.state === 'skipped';
const isOutAndUnpaid = (bill: MonthlyBill) => bill.state === 'overdue' || bill.state === 'dueSoon' || bill.state === 'open';

/** What a row is worth in a total: what it came to once paid, else its amount, else the estimate. */
export const amountOf = (bill: MonthlyBill) => (bill.state === 'paid' ? (bill.paidMinor ?? 0) : (bill.amountMinor ?? bill.estimateMinor ?? 0));

export const variesWords = (n: number) => (n === 1 ? '1 amount varies' : `${n} amounts vary`);

export interface BillSection {
  key: 'overdue' | 'dueSoon' | 'later' | 'settled';
  title: string;
  rows: MonthlyBill[];
}

export function sectionsOf(rows: readonly MonthlyBill[]): BillSection[] {
  const settled = rows.filter(isSettled);
  return [
    { key: 'overdue' as const, title: 'Overdue', rows: rows.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, title: 'Due soon', rows: rows.filter((b) => b.state === 'dueSoon') },
    { key: 'later' as const, title: 'Later', rows: rows.filter((b) => b.state === 'open' || b.state === 'upcoming') },
    { key: 'settled' as const, title: `Paid and skipped · ${settled.length}`, rows: settled },
  ].filter((section) => section.rows.length > 0);
}

const sum = (rows: readonly MonthlyBill[]) => rows.reduce((total, b) => total + amountOf(b), 0);
const anyVaries = (rows: readonly MonthlyBill[]) => rows.some((b) => b.amountMinor === null);

export interface BillSummary {
  monthLabel: string;
  totalMinor: number;
  approximate: boolean;
  variesText: string | null;
  lines: { key: 'overdue' | 'dueSoon' | 'later'; label: string; minor: number; approximate: boolean }[];
  allSettled: boolean;
}

export function summaryOf(rows: readonly MonthlyBill[], today: string): BillSummary {
  const open = rows.filter((b) => !isSettled(b));
  const varying = open.filter((b) => b.amountMinor === null).length;
  const groups = [
    { key: 'overdue' as const, label: 'Overdue', rows: open.filter((b) => b.state === 'overdue') },
    { key: 'dueSoon' as const, label: 'Due soon', rows: open.filter((b) => b.state === 'dueSoon') },
    { key: 'later' as const, label: 'Later this month', rows: open.filter((b) => b.state === 'open' || b.state === 'upcoming') },
  ];
  return {
    monthLabel: monthName(today.slice(0, 7), 'long'),
    totalMinor: sum(open),
    approximate: varying > 0,
    variesText: varying > 0 ? variesWords(varying) : null,
    lines: groups.filter((g) => sum(g.rows) > 0).map((g) => ({ key: g.key, label: g.label, minor: sum(g.rows), approximate: anyVaries(g.rows) })),
    allSettled: open.length === 0,
  };
}

/** What the Cashflow card calls owed: every bill that is out and unpaid. */
export function owedNow(rows: readonly MonthlyBill[]): { minor: number; approximate: boolean } {
  const out = rows.filter(isOutAndUnpaid);
  return { minor: sum(out), approximate: anyVaries(out) };
}

export function sublineOf(bill: MonthlyBill, accountName: string, today: string): string {
  return bill.billMonth < today.slice(0, 7) ? `${monthName(bill.billMonth, 'short')} bill · ${accountName}` : accountName;
}

export const PILL_CLASS: Record<BillTone, string> = {
  grey: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  green: 'bg-emerald-50 text-emerald-700',
};

export function pillOf(bill: Pick<MonthlyBill, 'state' | 'days' | 'window' | 'paidOn'>): { text: string; className: string } {
  const pill = billPill({ state: bill.state, days: bill.days }, bill.window, bill.paidOn);
  return { text: pill.text, className: PILL_CLASS[pill.tone] };
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
