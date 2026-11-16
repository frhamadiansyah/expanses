import { groupedMajorString, type InstalmentCountMode, matchPlanPurchase, parseGroupedMajor, type PlanPurchaseLine, purchaseCandidates } from '@expanses/core';

/** What the instalment plan sheet holds while it is open: every field as the person typed it. */
export interface PlanForm {
  description: string;
  total: string;
  months: string;
  firstBilledMonth: string;
  earnsPoints: boolean;
  /** The card purchase the plan was converted from; null for none chosen. */
  transactionId: string | null;
  /** With no purchase: the category it counts in; null is Uncategorised (0122). */
  categoryAccountId: string | null;
  /** With no purchase: Investment (not spending) chosen in the Category row — saving, kept At purchase. */
  investment: boolean;
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
  categoryAccountId: string | null;
}

/** A new plan's sheet: nothing typed, twelve months, starting this month, no points until said, counted each month. */
export const blankPlanForm = (today: string): PlanForm => ({
  description: '',
  total: '',
  months: '12',
  firstBilledMonth: today.slice(0, 7),
  earnsPoints: false,
  transactionId: null,
  categoryAccountId: null,
  investment: false,
});

/** An existing plan's sheet: its own figures, in the shapes the fields take (the total grouped, as the amount field shows it). */
export const planFormOf = (
  plan: {
    description: string;
    totalMinor: number;
    months: number;
    firstBilledMonth: string;
    earnsPoints: boolean;
    transactionId?: string | null;
    countMode?: InstalmentCountMode;
    categoryAccountId?: string | null;
  },
  currency: string,
): PlanForm => ({
  description: plan.description,
  total: groupedMajorString(plan.totalMinor, currency),
  months: String(plan.months),
  firstBilledMonth: plan.firstBilledMonth,
  earnsPoints: plan.earnsPoints,
  transactionId: plan.transactionId ?? null,
  categoryAccountId: plan.categoryAccountId ?? null,
  // A plan with no purchase kept At purchase reads as Investment.
  investment: !plan.transactionId && plan.countMode === 'at_purchase',
});

/**
 * The typed fields as numbers. A blank name becomes "Instalment plan"; a total is read as the grouped text of the amount
 * field (dots are thousands, a comma is cents). How it counts is the app's to decide (TF 139): a spending purchase Each
 * month, an investment buy (`trade`) or Investment At purchase, a spending category Each month.
 */
export const planFields = (form: PlanForm, currency: string, opts: { trade?: boolean } = {}): PlanFields => ({
  description: form.description.trim() || 'Instalment plan',
  totalMinor: parseGroupedMajor(form.total, currency),
  months: Number(form.months),
  firstBilledMonth: form.firstBilledMonth,
  earnsPoints: form.earnsPoints,
  transactionId: form.transactionId,
  countMode: (form.transactionId ? opts.trade === true : form.investment) ? 'at_purchase' : 'each_month',
  // A category is only the plan's own while no purchase is chosen and it is spending; with one, the purchase's count.
  categoryAccountId: form.transactionId || form.investment ? null : form.categoryAccountId,
});

/** A card purchase the Purchase row offers: what it was, when, and what it charged. */
export interface PurchaseChoice {
  transactionId: string;
  occurredOn: string;
  description: string;
  amountMinor: number;
  /** An investment bought with the card: its plan counts At purchase. */
  trade: boolean;
}

/**
 * The purchases a plan can be tied to: the card's own charges, not an instalment row, not already another plan's,
 * newest first — those charging the plan's total first of all, since that is nearly always the one.
 */
export function purchaseChoices(
  lines: readonly (PlanPurchaseLine & { description: string })[],
  planId: string | null,
  totalMinor: number,
  limit = 40,
): PurchaseChoice[] {
  return purchaseCandidates(lines, planId)
    .map((line) => ({ transactionId: line.transactionId, occurredOn: line.occurredOn, description: line.description, amountMinor: line.owedMinor, trade: line.trade === true }))
    .sort((a, b) => Number(b.amountMinor === totalMinor) - Number(a.amountMinor === totalMinor) || b.occurredOn.localeCompare(a.occurredOn))
    .slice(0, limit);
}

/**
 * The purchase a new plan's sheet shows (owner, 16 Nov 2026: "I don't want to pick manually"): while the owner has not
 * touched the Purchase row, the one purchase of the typed total in the window around First billed (`matchPlanPurchase`),
 * else none; once touched, what they chose — None included.
 */
export function shownPurchase(form: Pick<PlanForm, 'transactionId' | 'firstBilledMonth'>, totalMinor: number, lines: readonly PlanPurchaseLine[], touched: boolean): string | null {
  if (touched) return form.transactionId;
  return matchPlanPurchase(lines, { id: null, totalMinor, firstBilledMonth: form.firstBilledMonth });
}
