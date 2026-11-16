import { formatMinor, instalmentsFrom, monthName, periodMonthOf, type PlanPurchaseLine, unlinkedPurchaseOfTotal } from '@expanses/core';
import type { PlanInstalmentStatus } from '@expanses/db';

/*
 * The app decides how a plan counts (owner, 16 Nov 2026, TF 139) — no choice on any screen:
 * - tied to a spending purchase: its instalments are spending, a month at a time, in the purchase's category;
 * - tied to an investment buy, or with no purchase and Investment chosen: saving, never spending;
 * - with no purchase and a spending category (Uncategorised when none is chosen): spending in that category.
 * Kept as count_mode: Each month for spending, At purchase for an investment.
 */

const monthWords = (month: string, withYear: boolean) => `${monthName(month, 'long')}${withYear ? ` ${month.slice(0, 4)}` : ''}`;

/** The months a plan's instalments count in: "in each month from December to November 2027". Empty with none counted. */
function spanOf(schedule: readonly { statementOn: string }[], monthStart: number): string {
  const first = schedule[0] ? periodMonthOf(schedule[0].statementOn, monthStart) : null;
  const last = schedule.at(-1) ? periodMonthOf(schedule.at(-1)!.statementOn, monthStart) : null;
  if (!first || !last) return '';
  return first === last ? `in ${monthWords(first, true)}` : `in each month from ${monthWords(first, first.slice(0, 4) !== last.slice(0, 4) && schedule.length > 12)} to ${monthWords(last, true)}`;
}

/**
 * How a plan counts, said in one plain line (its page, and its sheet's footer):
 * "Counts Rp 1.000.000 a month as Electronics spending, in each month from December to November 2027." or
 * "Investment: Rp 1.000.000 a month counts as saving, not spending." With no purchase, only what is billed from the card's
 * start in the app counts (`instalmentsFrom`).
 */
export function countingLine(
  plan: { investment: boolean; monthlyMinor: number; transactionId: string | null },
  schedule: readonly { statementOn: string }[],
  currency: string,
  monthStart = 1,
  opts: { categoryName?: string | null; recordsFrom?: string | null } = {},
): string {
  const monthly = formatMinor(plan.monthlyMinor, currency);
  if (plan.investment) return `Investment: ${monthly} a month counts as saving, not spending.`;
  const counted = plan.transactionId ? schedule : instalmentsFrom(schedule, opts.recordsFrom ?? null);
  const span = spanOf(counted, monthStart);
  return `Counts ${monthly} a month as ${opts.categoryName ?? 'Uncategorised'} spending${span ? `, ${span}` : ''}.`;
}

/**
 * Whether a plan with no purchase may be counted twice (owner, 16 Nov 2026): only when the card holds a purchase of the
 * plan's total that no plan is tied to. Otherwise its purchase is simply not in the app, and nothing is said.
 */
export const mayCountTwice = (plan: { id: string | null; transactionId: string | null; totalMinor: number }, lines: readonly PlanPurchaseLine[]): boolean =>
  !plan.transactionId && unlinkedPurchaseOfTotal(lines, plan);

/** The line such a plan shows above Save and on its page: which purchase it probably is, said by what it would double. */
export function noPurchaseWarning(countTwice: boolean, investment: boolean, categoryName?: string | null): string | null {
  if (!countTwice) return null;
  return investment
    ? 'No purchase chosen: the card holds a purchase of this total, and each instalment is billed on top of it.'
    : `No purchase chosen: each instalment counts as ${categoryName ?? 'Uncategorised'} spending, on top of the purchase.`;
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
