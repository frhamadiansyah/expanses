import { divRound } from '../assets/units';

export type BudgetFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export const BUDGET_FREQUENCIES: readonly BudgetFrequency[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

/** How many of the unit make a month, as a fraction. A year is 52 weeks and 365 days — never 4 weeks or 30 days a month. */
const PER_MONTH: Record<BudgetFrequency, readonly [bigint, bigint]> = {
  daily: [365n, 12n],
  weekly: [52n, 12n],
  monthly: [1n, 1n],
  quarterly: [1n, 3n],
  yearly: [1n, 12n],
};

/** One budget line as a monthly figure, rounded once, half away from zero, in the currency's minor units. */
export function perMonthMinor(amountMinor: number, frequency: BudgetFrequency): number {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('An amount must be a whole number of minor units');
  const [numerator, denominator] = PER_MONTH[frequency];
  return Number(divRound(BigInt(amountMinor) * numerator, denominator));
}
