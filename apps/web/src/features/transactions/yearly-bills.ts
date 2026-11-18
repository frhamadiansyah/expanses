import type { Period } from '@expanses/core';

/**
 * Yearly bills on Cashflow (owner, 2026-11-18): a payment of a bill that repeats once a year — life insurance, a car's
 * tax — makes a spike in the month it is paid. One plain rule, as own transfers once had: over a month (or anything
 * shorter than a year) such a payment is listed in grey and left out of the ring, the total, the bars and the day's
 * total; over a year or longer it counts like any other spending, in its own category's slice. The ⋯ menu's Yearly bills
 * switch counts them in a month too. Reports, Budget, the tax report and every other page are untouched.
 *
 * Which payments: only those linked to a bill whose repeat is yearly (`TransactionView.yearlyBill`). Nothing is guessed
 * from a category or an amount.
 */

/** Where this device keeps the switch. A convenience: losing it puts the switch back off. Never synced. */
export const YEARLY_BILLS_KEY = 'expanses.cashflow.yearly-bills';

/** Whether this device has the switch on. Off unless it was turned on here. */
export function readYearlyBillsShown(): boolean {
  try {
    return localStorage.getItem(YEARLY_BILLS_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeYearlyBillsShown(on: boolean): void {
  try {
    if (on) localStorage.setItem(YEARLY_BILLS_KEY, '1');
    else localStorage.removeItem(YEARLY_BILLS_KEY);
  } catch {
    // Private windows can refuse storage; the switch still holds for this visit.
  }
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/**
 * Whether a period is a year or longer, and so counts yearly bills whatever the switch says: a year, all time, or two
 * chosen dates 365 days or more, both days counted. A week, a month and a quarter are shorter.
 */
export function periodCountsYearlyBills(period: Pick<Period, 'kind' | 'from' | 'to'> | null): boolean {
  if (!period) return false;
  if (period.kind === 'year' || period.kind === 'all') return true;
  if (period.kind === 'custom' && period.from && period.to) return dayNumber(period.to) - dayNumber(period.from) + 1 >= 365;
  return false;
}

/** Whether Cashflow, showing this period with the switch as it is, leaves yearly bills out of its figures. */
export function leavesOutYearlyBills(period: Pick<Period, 'kind' | 'from' | 'to'> | null, shown: boolean): boolean {
  return !shown && !periodCountsYearlyBills(period);
}

/** The grey note over the list: "1 yearly bill not in the ring", "2 yearly bills not in the ring". */
export function yearlyBillsNote(count: number): string | null {
  if (count <= 0) return null;
  return `${count} yearly bill${count === 1 ? '' : 's'} not in the ring`;
}

/** What goes under a yearly bill's amount on a month's Cashflow. */
export const YEARLY_BILL_LINE = 'Yearly bill · in the year';
