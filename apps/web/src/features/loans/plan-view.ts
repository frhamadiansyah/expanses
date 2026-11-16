import { formatMinor, type InstalmentCountMode, monthName, periodMonthOf } from '@expanses/core';
import type { PlanInstalmentStatus } from '@expanses/db';

/** The two ways a plan's spending counts, as the plan's control names them. */
export const COUNT_SEGMENTS = [
  { key: 'at_purchase', label: 'At purchase' },
  { key: 'each_month', label: 'Each month' },
] as const;

const monthWords = (month: string, withYear: boolean) => `${monthName(month, 'long')}${withYear ? ` ${month.slice(0, 4)}` : ''}`;

/**
 * What the Count spending control's footer says (mockup B): under Each month the amount and the months it counts in —
 * "Rp 1.000.000 counts in each month from December to November 2027." — the months being the workspace's, which hold
 * each statement date. A plan with no purchase says where it counts instead; At purchase says the purchase counts whole.
 */
export function countSpendingFooter(
  plan: { countMode: InstalmentCountMode; monthlyMinor: number; totalMinor: number; months: number; transactionId: string | null },
  schedule: readonly { statementOn: string }[],
  currency: string,
  monthStart = 1,
): string {
  if (plan.countMode === 'at_purchase') {
    return plan.transactionId
      ? `At purchase: the whole ${formatMinor(plan.totalMinor, currency)} counts on the day of the purchase; each instalment repays the card.`
      : 'At purchase: no purchase is chosen, so nothing counts as spending.';
  }
  const first = schedule[0] ? periodMonthOf(schedule[0].statementOn, monthStart) : null;
  const last = schedule.at(-1) ? periodMonthOf(schedule.at(-1)!.statementOn, monthStart) : null;
  if (!first || !last) return '';
  const span = first === last ? `in ${monthWords(first, true)}` : `in each month from ${monthWords(first, first.slice(0, 4) !== last.slice(0, 4) && plan.months > 12)} to ${monthWords(last, true)}`;
  const where = plan.transactionId ? '' : ' Under Uncategorised, as no purchase is chosen.';
  return `Each month: ${formatMinor(plan.monthlyMinor, currency)} counts ${span}.${where}`;
}

/** The plan's own page (mockup "after"): how far it is, what is left, when it ends, and its instalments. */
export interface PlanProgress {
  paid: number;
  billed: number;
  of: number;
  /** What is not yet paid: the total less the instalments paid. */
  leftMinor: number;
  /** The month the last instalment is billed in, as YYYY-MM. */
  endsMonth: string | null;
  /** Billed and paid instalments, newest first, after the next one still to come. */
  rows: PlanInstalmentStatus[];
}

export function planProgress(totalMinor: number, statuses: readonly PlanInstalmentStatus[]): PlanProgress {
  const paidRows = statuses.filter((row) => row.status === 'paid');
  const billedRows = statuses.filter((row) => row.status !== 'upcoming');
  const next = statuses.find((row) => row.status === 'upcoming');
  return {
    paid: paidRows.length,
    billed: billedRows.length,
    of: statuses.length,
    leftMinor: totalMinor - paidRows.reduce((sum, row) => sum + row.amountMinor, 0),
    endsMonth: statuses.at(-1)?.statementOn.slice(0, 7) ?? null,
    rows: [...(next ? [next] : []), ...[...billedRows].reverse()],
  };
}
