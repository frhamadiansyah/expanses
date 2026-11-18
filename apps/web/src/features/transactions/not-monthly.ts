import type { Period } from '@expanses/core';

/**
 * Not-monthly costs on Cashflow (owner, 2026-11-18; widened from yearly bills the same day, mockup
 * docs/mockups/2026-11-18-not-monthly-costs-v2.html option D): a payment of a bill that repeats less often than every
 * month — a year's life insurance, a car service every 6 months — makes a spike in the month it is paid. One plain rule,
 * as own transfers once had: over anything shorter than a year such a payment is listed, its amount grey and a small ↻
 * on its category's circle, and left out of the ring, the total, the bars and the day's total; over a year or longer it
 * counts like any other spending, in its own category's slice. The ⋯ menu's Not monthly row (Hidden / Shown) counts
 * them in a month too. Reports, Budget, the tax report and every other page are untouched.
 *
 * Which payments: only those linked to a bill whose repeat is yearly or every 2 months or more
 * (`isNotMonthlyRepeat`, `TransactionView.notMonthlyBill`). Nothing is guessed from a category or an amount.
 */

/** Where this device keeps the choice: '1' Shown, '0' Hidden. A convenience: losing it puts it back to Hidden. Never synced. */
export const NOT_MONTHLY_KEY = 'expanses.cashflow.not-monthly';
/** Build 149's key for the same choice, when the row was a Yearly bills switch: '1' on, absent off. Read once, then gone. */
export const OLD_YEARLY_BILLS_KEY = 'expanses.cashflow.yearly-bills';

/** Whether this device shows not-monthly costs in a month. Hidden unless chosen here (or, before, Yearly bills was on). */
export function readNotMonthlyShown(): boolean {
  try {
    const now = localStorage.getItem(NOT_MONTHLY_KEY);
    if (now !== null) return now === '1';
    // Build 149's switch, carried over once: its choice becomes this one and the old key goes.
    const old = localStorage.getItem(OLD_YEARLY_BILLS_KEY);
    if (old === null) return false;
    const shown = old === '1';
    localStorage.setItem(NOT_MONTHLY_KEY, shown ? '1' : '0');
    localStorage.removeItem(OLD_YEARLY_BILLS_KEY);
    return shown;
  } catch {
    return false;
  }
}

export function writeNotMonthlyShown(shown: boolean): void {
  try {
    localStorage.setItem(NOT_MONTHLY_KEY, shown ? '1' : '0');
    localStorage.removeItem(OLD_YEARLY_BILLS_KEY);
  } catch {
    // Private windows can refuse storage; the choice still holds for this visit.
  }
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Whether a period is a year or longer, and so counts not-monthly costs whatever the ⋯ menu says (and offers no row for
 * them): a year, all time, or two chosen dates 365 days or more, both days counted. A week, a month and a quarter are
 * shorter.
 */
export function periodCountsNotMonthly(period: Pick<Period, 'kind' | 'from' | 'to'> | null): boolean {
  if (!period) return false;
  if (period.kind === 'year' || period.kind === 'all') return true;
  if (period.kind === 'custom' && period.from && period.to) return dayNumber(period.to) - dayNumber(period.from) + 1 >= 365;
  return false;
}

/** Whether Cashflow, showing this period with the ⋯ menu's choice as it is, leaves not-monthly costs out of its figures. */
export function leavesOutNotMonthly(period: Pick<Period, 'kind' | 'from' | 'to'> | null, shown: boolean): boolean {
  return !shown && !periodCountsNotMonthly(period);
}

/** The grey note over the list: "1 not in the ring", "3 not in the ring"; nothing for none. */
export function notMonthlyNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} not in the ring`;
}

/** The grey word on the ⋯ menu's Not monthly row. */
export const notMonthlyWord = (shown: boolean): string => (shown ? 'Shown' : 'Hidden');

/** What the small ↻ on a left-out row's circle says aloud. */
export const NOT_MONTHLY_LABEL = 'Not monthly';

/** The footnote under a bill's Repeats when it is not monthly. */
export const NOT_MONTHLY_BILL_NOTE = "Not monthly: left out of a month's ring, counted in the year.";
