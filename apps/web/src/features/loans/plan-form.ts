import { groupedMajorString, type InstalmentCountMode, parseGroupedMajor } from '@expanses/core';

/** What the instalment plan sheet holds while it is open: every field as the person typed it. */
export interface PlanForm {
  description: string;
  total: string;
  months: string;
  firstBilledMonth: string;
  earnsPoints: boolean;
  /** The card purchase the plan was converted from; null for none chosen. */
  transactionId: string | null;
  /** How its spending counts (option C): Each month for a new plan. */
  countMode: InstalmentCountMode;
}

/** The plan as the db takes it, without the card or the id. */
export interface PlanFields {
  description: string;
  totalMinor: number;
  months: number;
  firstBilledMonth: string;
  earnsPoints: boolean;
  transactionId: string | null;
  countMode: InstalmentCountMode;
}

/** A new plan's sheet: nothing typed, twelve months, starting this month, no points until said, counted each month. */
export const blankPlanForm = (today: string): PlanForm => ({
  description: '',
  total: '',
  months: '12',
  firstBilledMonth: today.slice(0, 7),
  earnsPoints: false,
  transactionId: null,
  countMode: 'each_month',
});

/** An existing plan's sheet: its own figures, in the shapes the fields take (the total grouped, as the amount field shows it). */
export const planFormOf = (
  plan: { description: string; totalMinor: number; months: number; firstBilledMonth: string; earnsPoints: boolean; transactionId?: string | null; countMode?: InstalmentCountMode },
  currency: string,
): PlanForm => ({
  description: plan.description,
  total: groupedMajorString(plan.totalMinor, currency),
  months: String(plan.months),
  firstBilledMonth: plan.firstBilledMonth,
  earnsPoints: plan.earnsPoints,
  transactionId: plan.transactionId ?? null,
  countMode: plan.countMode ?? 'each_month',
});

/** The typed fields as numbers. A blank name becomes "Instalment plan"; a total is read as the grouped text of the amount field (dots are thousands, a comma is cents). */
export const planFields = (form: PlanForm, currency: string): PlanFields => ({
  description: form.description.trim() || 'Instalment plan',
  totalMinor: parseGroupedMajor(form.total, currency),
  months: Number(form.months),
  firstBilledMonth: form.firstBilledMonth,
  earnsPoints: form.earnsPoints,
  transactionId: form.transactionId,
  countMode: form.countMode,
});

/** A card purchase the Purchase row offers: what it was, when, and what it charged. */
export interface PurchaseChoice {
  transactionId: string;
  occurredOn: string;
  description: string;
  amountMinor: number;
}

/**
 * The purchases a plan can be tied to: the card's own charges, not an instalment row, not already another plan's,
 * newest first — those charging the plan's total first of all, since that is nearly always the one.
 */
export function purchaseChoices(
  lines: readonly { transactionId: string; occurredOn: string; description: string; owedMinor: number; spending: boolean; instalment: unknown; balancing: boolean; convertedTo: { planId: string } | null }[],
  planId: string | null,
  totalMinor: number,
  limit = 40,
): PurchaseChoice[] {
  return lines
    .filter((line) => line.spending && line.owedMinor > 0 && !line.instalment && !line.balancing && (!line.convertedTo || line.convertedTo.planId === planId))
    .map((line) => ({ transactionId: line.transactionId, occurredOn: line.occurredOn, description: line.description, amountMinor: line.owedMinor }))
    .sort((a, b) => Number(b.amountMinor === totalMinor) - Number(a.amountMinor === totalMinor) || b.occurredOn.localeCompare(a.occurredOn))
    .slice(0, limit);
}
