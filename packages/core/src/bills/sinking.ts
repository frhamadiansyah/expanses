import { roundUpToMajor } from '../money/money';
import { monthOf } from '../reports/periods';
import { firstYearlyMonth } from './schedule';

/*
 * A sinking fund: money put aside each month for a yearly bill. Nothing is recorded month by month — the figure set
 * aside is worked out from the day, so it needs no job to run and cannot drift.
 */

/** Whole months from one YYYY-MM to another; negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

export interface SinkingPlan {
  /** YYYY-MM the bill is next due in. */
  dueMonth: string;
  /** Months to save in, this one included, never below one. */
  monthsLeft: number;
  /** The amount to set aside each month: enough to reach the bill, rounded up to a whole unit of the currency. */
  monthlyMinor: number;
}

/**
 * What to set aside each month for a yearly bill made today. A date already past this month means next year's, and a
 * bill due this month or next leaves one month, so the whole amount is set aside at once.
 */
export function sinkingPlan(input: { targetMinor: number; today: string; repeatMonth: number; dayOfMonth: number; currency: string }): SinkingPlan {
  const dueMonth = firstYearlyMonth(input.today, input.repeatMonth, input.dayOfMonth);
  const monthsLeft = Math.max(1, monthsBetween(monthOf(input.today), dueMonth));
  const monthlyMinor = roundUpToMajor(Math.ceil(input.targetMinor / monthsLeft), input.currency);
  return { dueMonth, monthsLeft, monthlyMinor };
}

export interface SinkingFundFacts {
  monthlyMinor: number;
  /** YYYY-MM the saving began; that month counts. */
  startedMonth: string;
  /** One-off money put in on top (`Put in extra`). */
  extraMinor: number;
}

export interface SinkingProgress {
  /** What is set aside today: the monthly figure for every month begun, plus extras, never above the target. */
  savedMinor: number;
  /** Months set aside so far, this one included, never above `monthsTotal`. */
  monthsDone: number;
  /** Months from the start to the due month, at least one. */
  monthsTotal: number;
}

export function sinkingProgress(fund: SinkingFundFacts, targetMinor: number, dueMonth: string, today: string): SinkingProgress {
  const begun = Math.max(0, monthsBetween(fund.startedMonth, monthOf(today)) + 1);
  const monthsTotal = Math.max(1, monthsBetween(fund.startedMonth, dueMonth));
  const savedMinor = Math.max(0, Math.min(targetMinor, fund.monthlyMinor * begun + fund.extraMinor));
  return { savedMinor, monthsDone: Math.min(monthsTotal, begun), monthsTotal };
}
