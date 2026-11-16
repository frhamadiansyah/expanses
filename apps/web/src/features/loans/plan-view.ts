import { formatMinor, type InstalmentCountMode, instalmentsFrom, monthName, periodMonthOf, type PlanPurchaseLine, planPurchaseOutcome } from '@expanses/core';
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
  opts: { categoryName?: string | null; recordsFrom?: string | null } = {},
): string {
  if (plan.countMode === 'at_purchase') {
    return plan.transactionId
      ? `At purchase: the whole ${formatMinor(plan.totalMinor, currency)} counts on the day of the purchase; each instalment repays the card.`
      : 'At purchase: no purchase is chosen, so nothing counts as spending.';
  }
  // With no purchase, what was billed before the card's records start counts nowhere (`instalmentsFrom`).
  const counted = plan.transactionId ? schedule : instalmentsFrom(schedule, opts.recordsFrom ?? null);
  const first = counted[0] ? periodMonthOf(counted[0].statementOn, monthStart) : null;
  const last = counted.at(-1) ? periodMonthOf(counted.at(-1)!.statementOn, monthStart) : null;
  if (!first || !last) return plan.transactionId ? '' : 'Each month: every instalment was billed before this card’s records in the app, so nothing counts.';
  const span = first === last ? `in ${monthWords(first, true)}` : `in each month from ${monthWords(first, first.slice(0, 4) !== last.slice(0, 4) && counted.length > 12)} to ${monthWords(last, true)}`;
  const where = plan.transactionId ? '' : ` Under ${opts.categoryName ?? 'Uncategorised'}, as no purchase is chosen.`;
  return `Each month: ${formatMinor(plan.monthlyMinor, currency)} counts ${span}.${where}`;
}

/**
 * Where a plan's purchase stands (owner, 16 Nov 2026): tied to one; bought before the card's records in the app, so there
 * is none to tie and nothing to count twice; or left with none chosen though its purchase may be recorded.
 */
export type PurchaseState = 'linked' | 'before-records' | 'unlinked';

export function purchaseStateOf(
  plan: { id: string | null; transactionId: string | null; totalMinor: number; firstBilledMonth: string },
  lines: readonly PlanPurchaseLine[],
  recordsFrom: string | null,
): PurchaseState {
  if (plan.transactionId) return 'linked';
  return planPurchaseOutcome(lines, plan, recordsFrom).kind === 'before-records' ? 'before-records' : 'unlinked';
}

/**
 * The line a plan with no purchase chosen shows (mockup "warning if none"): under Each month its instalments would count
 * on top of the purchase recorded on its day. Under At purchase, on the plan's page, what choosing it would do. Nothing
 * for a plan tied to its purchase, or one bought before the card's records (no purchase is recorded to count twice).
 */
export function noPurchaseWarning(state: PurchaseState, countMode: InstalmentCountMode, categoryName?: string | null, onPage = false): string | null {
  if (state !== 'unlinked') return null;
  if (countMode === 'each_month') return `No purchase chosen: each instalment counts as ${categoryName ?? 'Uncategorised'} spending, on top of the purchase.`;
  return onPage ? 'No purchase chosen: choose the purchase it came from to count it each month.' : null;
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
