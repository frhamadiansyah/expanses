import { type CardInstallment, formatMinor, installmentSplit, owedAfter } from '@expanses/core';

/**
 * How a card's limit is taken up. An instalment purchase is recorded on the card at its full price, so what the
 * plan has not billed yet is already inside what is owed: it is shown as part of the used amount, never taken
 * off the limit a second time.
 */
export interface LimitUsage {
  /** Everything owed on the card, instalments included. */
  usedMinor: number;
  /** The part of what is owed that instalments have not billed yet. */
  heldMinor: number;
  /** What can still be spent; negative when over the limit. */
  availableMinor: number | null;
  /** Bar widths as whole percentages of the limit: owed outside instalments, then held by them. */
  barUsedPct: number;
  barHeldPct: number;
  usedPct: number | null;
}

export function limitUsage(owedMinor: number, limitMinor: number | null, unbilledMinor: number): LimitUsage {
  const used = Math.max(0, owedMinor);
  // Instalments cannot hold more than is owed: a card paid off early has nothing left for them to hold.
  const held = Math.min(Math.max(0, unbilledMinor), used);
  if (!limitMinor || limitMinor <= 0) return { usedMinor: used, heldMinor: held, availableMinor: null, barUsedPct: 0, barHeldPct: 0, usedPct: null };
  const pct = (minor: number) => Math.min(100, Math.round((minor / limitMinor) * 100));
  const barHeldPct = pct(held);
  return {
    usedMinor: used,
    heldMinor: held,
    availableMinor: limitMinor - owedMinor,
    barUsedPct: Math.max(0, pct(used) - barHeldPct),
    barHeldPct,
    usedPct: pct(used),
  };
}

/**
 * The one figure on a card's back. A card owes, or the bank holds a credit on it — never both — so the label names
 * which: "Outstanding" for what is owed, "Credit" for money paid past it. No second line is needed for either.
 */
export function cardBackFigure(owedMinor: number, creditMinor: number): { label: 'Outstanding' | 'Credit'; minor: number } {
  return creditMinor > 0 ? { label: 'Credit', minor: creditMinor } : { label: 'Outstanding', minor: owedMinor };
}

/** A plan as the due-now figure reads it: its card, whether it came from a purchase, and how many are ticked paid. */
export interface PlanForDueNow extends CardInstallment {
  cardAccountId: string;
  transactionId: string | null;
  paidSoFar: number;
}

/**
 * The part of what a card owes that a plan has not billed yet (owner, 17 Nov 2026): its instalments after the ones billed
 * by this month (`installmentSplit`, the figure the limit bar hatches). A plan with no purchase is owed only through its
 * owed line — the instalments after those ticked paid — so it never holds more than that line.
 */
export function laterInstalmentsMinor(plan: PlanForDueNow, today: string): number {
  const later = installmentSplit(plan, today).unbilledMinor;
  return plan.transactionId === null ? Math.min(later, owedAfter(plan, plan.paidSoFar)) : later;
}

/** `laterInstalmentsMinor` added up by card; a card with nothing later is left out. */
export function laterByCard(plans: readonly PlanForDueNow[], today: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const plan of plans) {
    const later = laterInstalmentsMinor(plan, today);
    if (later > 0) out[plan.cardAccountId] = (out[plan.cardAccountId] ?? 0) + later;
  }
  return out;
}

/**
 * What is due now on a card: what it owes less the instalments not billed yet — never below nothing. The card's
 * back and Wallet show it; Net worth, Debts, the Debt-free plan and the tax report keep the whole debt.
 */
export function dueNowMinor(owedMinor: number, laterMinor: number): number {
  const owed = Math.max(0, owedMinor);
  return owed - Math.min(Math.max(0, laterMinor), owed);
}

/**
 * The line under the limit bar on the card's back: "Rp 17.500.000 available · Rp 10.000.000 in instalments" while
 * instalments hold part of the limit (the limit itself then left unsaid), "… available of Rp 30.000.000" otherwise.
 */
export function availableLine(usage: LimitUsage, limitMinor: number, currency: string): string {
  const available = usage.availableMinor ?? 0;
  if (available < 0) return `Over the limit by ${formatMinor(-available, currency)}`;
  if (usage.heldMinor > 0) return `${formatMinor(available, currency)} available · ${formatMinor(usage.heldMinor, currency)} in instalments`;
  return `${formatMinor(available, currency)} available of ${formatMinor(limitMinor, currency)}`;
}
