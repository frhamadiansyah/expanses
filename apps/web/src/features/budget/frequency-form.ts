import { averageMonthlyMinor, type BudgetFrequency, budgetMonthMinor, isCountedRepeat, parseMajor, perMonthMinor } from '@expanses/core';
import { type BudgetMonth, type BudgetRow, followedBill } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';

/** The words for each unit. "Monthly amount" is the label the page has always had, so existing specs still find it. */
export const FREQUENCY_WORDS: Record<BudgetFrequency, { every: string; amount: string; per: string }> = {
  daily: { every: 'Day', amount: 'Daily amount', per: 'a day' },
  weekly: { every: 'Week', amount: 'Weekly amount', per: 'a week' },
  monthly: { every: 'Month', amount: 'Monthly amount', per: 'a month' },
  quarterly: { every: 'Quarter', amount: 'Quarterly amount', per: 'a quarter' },
  yearly: { every: 'Year', amount: 'Yearly amount', per: 'a year' },
};

/**
 * What a budget is typed per, as one choice (Budget C): a unit, or a week's gap of 2 to 8 weeks ("weeks-3" is every 3
 * weeks). Every week is 'weekly'.
 */
export type BudgetUnit = BudgetFrequency | `weeks-${number}`;

const GAPS = [2, 3, 4, 5, 6, 7, 8] as const;

/** Every choice, in the order the Every list shows them. */
export const BUDGET_UNITS: readonly BudgetUnit[] = ['daily', 'weekly', ...GAPS.map((n) => `weeks-${n}` as const), 'monthly', 'quarterly', 'yearly'];

/** The unit a stored budget is typed per. */
export function unitOf(frequency: BudgetFrequency, everyWeeks: number | null | undefined): BudgetUnit {
  return frequency === 'weekly' && everyWeeks && everyWeeks > 1 ? `weeks-${everyWeeks}` : frequency;
}

/** A unit as a budget keeps it: its frequency, and for every few weeks their number. */
export function repeatOfUnit(unit: BudgetUnit): { frequency: BudgetFrequency; everyWeeks: number | null } {
  const weeks = /^weeks-(\d)$/.exec(unit);
  return weeks ? { frequency: 'weekly', everyWeeks: Number(weeks[1]) } : { frequency: unit as BudgetFrequency, everyWeeks: null };
}

/** Whether the unit is every few weeks, which is counted from a start date. */
export const isWeeksUnit = (unit: BudgetUnit) => repeatOfUnit(unit).everyWeeks !== null;

/** "Day", "Week", "3 weeks", "Month": the Every list's words. */
export function unitWord(unit: BudgetUnit): string {
  const { frequency, everyWeeks } = repeatOfUnit(unit);
  return everyWeeks !== null ? `${everyWeeks} weeks` : FREQUENCY_WORDS[frequency].every;
}

/** Where a unit is counted (Budget C): the month's days, and the category it is for with its start. */
export interface CountedIn {
  month: BudgetMonth;
  categoryId: string;
  startsOn: string | null;
}

/**
 * What an amount in `unit` comes to in the month: a day or a week × the times it comes up in `at`'s month (a week on
 * the dates of the category's bill by the same weeks, when it has one); a month, a quarter or a year as it always was.
 * Without the month's days to count, the average month.
 */
export function monthFigureOf(amountMinor: number, unit: BudgetUnit, at: CountedIn | null | undefined): number {
  const { frequency, everyWeeks } = repeatOfUnit(unit);
  const repeat = { frequency, everyWeeks, startsOn: at?.startsOn ?? null };
  if (!isCountedRepeat(repeat)) return perMonthMinor(amountMinor, frequency);
  if (!at) return averageMonthlyMinor(amountMinor, frequency, everyWeeks);
  return budgetMonthMinor(amountMinor, repeat, at.month.period, followedBill(at.month, at.categoryId, repeat)?.dates ?? null);
}

/** What a typed figure comes to in the month, or null while it cannot be read. `parseMajor` is the one reader. */
export function perMonthPreview(typed: string, unit: BudgetUnit, currency: string, at?: CountedIn | null): number | null {
  if (typed.trim() === '') return null;
  try {
    return monthFigureOf(parseMajor(typed, currency), unit, at);
  } catch {
    return null;
  }
}

/**
 * The second line under a budget by days or weeks on the Budget page: "100.000 a week", "50.000 a day",
 * "1.000.000 every 3 weeks". Null for every other budget, which keeps its row exactly as it was.
 */
export function repeatLine(row: BudgetRow | undefined, currency: string): string | null {
  if (!row || row.share || !isCountedRepeat(row)) return null;
  const figure = bareFigure(row.amountAsSetMinor, currency);
  if (row.frequency === 'weekly' && row.everyWeeks !== null && row.everyWeeks > 1) return `${figure} every ${row.everyWeeks} weeks`;
  return `${figure} ${FREQUENCY_WORDS[row.frequency].per}`;
}
