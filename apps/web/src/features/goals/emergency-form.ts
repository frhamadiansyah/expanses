import { type EmergencyBase, emergencyMonthsFor, type Household, type IncomeStability } from '@expanses/core';
import type { EmergencyInputs } from '@expanses/db';

export const HOUSEHOLD_LABELS: Record<Household, string> = { single: 'Single', couple: 'Married, no children', children: 'With children' };
export const INCOME_LABELS: Record<IncomeStability, string> = { salaried: 'Salaried', irregular: 'Freelance or irregular' };

export interface EmergencyDraft {
  household: Household;
  income: IncomeStability;
  months: string;
  /** True once the months were typed over: the two answers stop moving them. */
  monthsTyped: boolean;
  base: EmergencyBase;
}

export function emergencyDraftFrom(inputs?: EmergencyInputs): EmergencyDraft {
  const household = inputs?.household ?? 'single';
  const income = inputs?.income ?? 'salaried';
  const guide = emergencyMonthsFor(household, income);
  const months = inputs?.months ?? guide;
  return { household, income, months: String(months), monthsTyped: months !== guide, base: inputs?.base ?? 'essential' };
}

export function withAnswers(draft: EmergencyDraft, patch: { household?: Household; income?: IncomeStability }): EmergencyDraft {
  const next = { ...draft, ...patch };
  return next.monthsTyped ? next : { ...next, months: String(emergencyMonthsFor(next.household, next.income)) };
}

export function typedMonths(draft: EmergencyDraft, months: string): EmergencyDraft {
  return { ...draft, months, monthsTyped: true };
}

/**
 * The line under the months row — and only when the number is the reader's own.
 *
 * When the two answers above set it, the row has nothing to explain: naming the household and the income is the
 * row repeating the two rows directly above it, so it says nothing. A number typed over the guide is the one case
 * the row cannot account for on its own, so it says what the guide would have been.
 */
export function monthsNote(draft: EmergencyDraft): string | undefined {
  const guide = emergencyMonthsFor(draft.household, draft.income);
  return draft.monthsTyped && Number(draft.months) !== guide ? `Your own figure · the guide is ${guide}` : undefined;
}

export function emergencyInputsOf(draft: EmergencyDraft): EmergencyInputs {
  const months = Number(draft.months.replace(',', '.'));
  if (!Number.isFinite(months) || months <= 0) throw new Error('Months must be a number above zero');
  return { months, household: draft.household, income: draft.income, base: draft.base };
}
