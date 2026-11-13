import { addMonths, dayMonth, monthName } from '@expanses/core';
import type { ExpenseTemplateRow } from '@expanses/db';

/** "March 2026": a month written out with its year, as the link screens name one. */
export const monthWithYear = (month: string): string => `${monthName(month, 'long')} ${month.slice(0, 4)}`;

/** What an earlier month's row says on its right. */
export function purchaseCount(count: number): string {
  return count === 0 ? 'None found' : count === 1 ? '1 purchase' : `${count} purchases`;
}

/** A candidate's second line: "9 Mar · BCA Tahapan", the account left off when it is not known. */
export function candidateLine(occurredOn: string, accountName: string | null | undefined): string {
  return [dayMonth(occurredOn), accountName].filter(Boolean).join(' · ');
}

/** How often a bill comes out, in the words the bill picker uses: "Every month", "Every year", "Every 3 months". */
export function repeatWords(bill: Pick<ExpenseTemplateRow, 'repeat' | 'repeatEvery'>): string {
  if (bill.repeat === 'yearly') return 'Every year';
  if (bill.repeat === 'months') return `Every ${bill.repeatEvery} months`;
  return 'Every month';
}

/** Bills of the purchase's category first, then the rest, each in the order given. */
export function billsForPurchase<T extends Pick<ExpenseTemplateRow, 'categoryAccountId'>>(bills: readonly T[], categoryIds: readonly string[]): { same: T[]; others: T[] } {
  const same = bills.filter((bill) => categoryIds.includes(bill.categoryAccountId));
  return { same, others: bills.filter((bill) => !categoryIds.includes(bill.categoryAccountId)) };
}

/**
 * The months the purchase-side wheel offers: any month of the years from a few before the purchase to the year after
 * the newest a bill can take, so a purchase made late can still be put to the bill for an earlier month.
 */
export function wheelYears(purchaseMonth: string, todayMonth: string): string[] {
  const first = Number(purchaseMonth.slice(0, 4)) - 5;
  const last = Number(addMonths(todayMonth, 1).slice(0, 4));
  return Array.from({ length: Math.max(1, last - first + 1) }, (_, i) => String(first + i));
}

/** The words under the Month row when the chosen month cannot take the purchase. */
export function refusalText(code: string | undefined, month: string, fallback: string): string {
  if (code === 'ALREADY_SETTLED') return `${monthWithYear(month)} is already paid`;
  if (code === 'SKIPPED') return `${monthWithYear(month)} is skipped. Unskip it first.`;
  return fallback;
}

/**
 * What a tap on a bill in a receipt's list does. `link`: at once, in its month — only once the purchase is read and is
 * known to have no link (`settled`), so a tap made while that is still being read never moves a link it has. `months`:
 * the month page, whose ✓ is what moves a link. `wait`: nothing yet. `none`: a shared event's purchase, changed there.
 */
export function billTapAction(at: { settled: boolean; linked: boolean; locked: boolean; hasPurchase: boolean }): 'link' | 'months' | 'wait' | 'none' {
  if (!at.settled || !at.hasPurchase) return 'wait';
  if (at.locked) return 'none';
  return at.linked ? 'months' : 'link';
}
