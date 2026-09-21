import { type BudgetFrequency, parseMajor, perMonthMinor } from '@expanses/core';

/** The words for each unit. "Monthly amount" is the label the page has always had, so existing specs still find it. */
export const FREQUENCY_WORDS: Record<BudgetFrequency, { every: string; amount: string; per: string }> = {
  daily: { every: 'Day', amount: 'Daily amount', per: 'a day' },
  weekly: { every: 'Week', amount: 'Weekly amount', per: 'a week' },
  monthly: { every: 'Month', amount: 'Monthly amount', per: 'a month' },
  quarterly: { every: 'Quarter', amount: 'Quarterly amount', per: 'a quarter' },
  yearly: { every: 'Year', amount: 'Yearly amount', per: 'a year' },
};

/** What a typed figure comes to a month, or null while it cannot be read. `parseMajor` is the one reader. */
export function perMonthPreview(typed: string, frequency: BudgetFrequency, currency: string): number | null {
  if (typed.trim() === '') return null;
  try {
    return perMonthMinor(parseMajor(typed, currency), frequency);
  } catch {
    return null;
  }
}
