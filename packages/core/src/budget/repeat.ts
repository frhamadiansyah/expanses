import { divRound } from '../assets/units';
import { addDaysIso } from '../bills/weeks';
import { type BudgetFrequency, perMonthMinor } from './frequency';

/*
 * Budget C (2026-11-25): a budget typed the way it really repeats — Rp 50.000 a day, Rp 100.000 a week, Rp 1.000.000
 * every 3 weeks — is still watched by the month. A month's budget is the amount × how many times it comes up inside
 * that month's days (the workspace's month: calendar, or from its "Month starts on" day):
 *
 * - a day: every day of the month;
 * - a week: every Monday of the month (weeks start on Monday);
 * - every N weeks: every date N weeks apart from the budget's Starts on, forwards and back.
 *
 * One exception, so a budget and its bill never disagree: when the category has a bill that repeats by the same weeks
 * (a weekly bill for a week, every 3 weeks for every 3 weeks), the budget's dates in the month are that bill's due dates
 * — the days it was paid and the ones still due, the same dates the bill's page and "Of it, bills" count.
 *
 * A month, a quarter and a year are not counted: a month is its amount, and a quarter or a year is its average month, as
 * it always was.
 */

/** How a budget repeats: its unit, and for a week its gap in weeks (1 when none is kept) and the day it is counted from. */
export interface BudgetRepeat {
  frequency: BudgetFrequency;
  /** Weeks between its dates, 1 to 8; null or 1 is every week. Only a week has one. */
  everyWeeks: number | null;
  /** YYYY-MM-DD: the day every few weeks (2 or more) is counted from. */
  startsOn: string | null;
}

/** The days a budget month covers, both included. */
export interface BudgetPeriod {
  from: string;
  to: string;
}

const utcDay = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

/** How many days the period covers. */
export function daysIn(period: BudgetPeriod): number {
  return utcDay(period.to) - utcDay(period.from) + 1;
}

/** How many Mondays the period holds: how many weeks start inside it. */
export function mondaysIn(period: BudgetPeriod): number {
  // 1970-01-05, day 4 since the epoch, was a Monday.
  const firstMonday = (day: number) => day + ((((4 - day) % 7) + 7) % 7);
  const from = firstMonday(utcDay(period.from));
  const to = utcDay(period.to);
  return from > to ? 0 : Math.floor((to - from) / 7) + 1;
}

/** The dates `everyWeeks` weeks apart from `startsOn` that fall inside the period, oldest first. */
export function gridDatesIn(startsOn: string, everyWeeks: number, period: BudgetPeriod): string[] {
  const step = everyWeeks * 7;
  const behind = utcDay(period.from) - utcDay(startsOn);
  let next = addDaysIso(startsOn, Math.ceil(behind / step) * step);
  const dates: string[] = [];
  for (; next <= period.to; next = addDaysIso(next, step)) dates.push(next);
  return dates;
}

/** Whether the budget is counted by the month's days (a day or a week), rather than read as a month. */
export function isCountedRepeat(repeat: Pick<BudgetRepeat, 'frequency'>): boolean {
  return repeat.frequency === 'daily' || repeat.frequency === 'weekly';
}

const gapOf = (repeat: BudgetRepeat) => (repeat.everyWeeks && repeat.everyWeeks > 1 ? repeat.everyWeeks : 1);

/**
 * How many times a budget comes up in the period, or null for one that is not counted (a month, a quarter, a year).
 * `billDates` are the due dates in the period of the category's bill by the same weeks, or null when it has none.
 */
export function budgetTimesIn(repeat: BudgetRepeat, period: BudgetPeriod, billDates: readonly string[] | null): number | null {
  if (repeat.frequency === 'daily') return daysIn(period);
  if (repeat.frequency !== 'weekly') return null;
  if (billDates) return billDates.length;
  const every = gapOf(repeat);
  if (every === 1 || !repeat.startsOn) return mondaysIn(period);
  return gridDatesIn(repeat.startsOn, every, period).length;
}

/** A budget's figure for the month: the amount × the times it comes up, or its month as it always was. */
export function budgetMonthMinor(amountMinor: number, repeat: BudgetRepeat, period: BudgetPeriod, billDates: readonly string[] | null): number {
  const times = budgetTimesIn(repeat, period, billDates);
  if (times === null) return perMonthMinor(amountMinor, repeat.frequency);
  return Number(BigInt(amountMinor) * BigInt(times));
}

/**
 * The average month a budget comes to: what budgets.amount_minor keeps, for every reader that does not count a month's
 * days (an older build, a book changing currency). A few weeks is a week's average divided by their number.
 */
export function averageMonthlyMinor(amountMinor: number, frequency: BudgetFrequency, everyWeeks: number | null): number {
  if (frequency !== 'weekly' || !everyWeeks || everyWeeks <= 1) return perMonthMinor(amountMinor, frequency);
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('An amount must be a whole number of minor units');
  return Number(divRound(BigInt(amountMinor) * 52n, 12n * BigInt(everyWeeks)));
}
