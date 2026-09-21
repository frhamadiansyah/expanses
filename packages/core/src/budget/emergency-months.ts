export type Household = 'single' | 'couple' | 'children';
export type IncomeStability = 'salaried' | 'irregular';
export const HOUSEHOLDS: readonly Household[] = ['single', 'couple', 'children'];
export const INCOME_STABILITIES: readonly IncomeStability[] = ['salaried', 'irregular'];

/** The user's own matrix (2026-09-19): irregular income is exactly twice salaried. A prefill, never a rule. */
const SALARIED_MONTHS: Record<Household, number> = { single: 3, couple: 6, children: 12 };

export function emergencyMonthsFor(household: Household, income: IncomeStability): number {
  const months = SALARIED_MONTHS[household];
  return income === 'irregular' ? months * 2 : months;
}
