import { installmentSplit } from '@expanses/core';
import type { CardInstallmentRow, PlanInstalmentStatus } from '@expanses/db';

/** An active card instalment plan as Recurring's Monthly page lists it: information only, never part of a bills total. */
export interface InstalmentLine {
  id: string;
  cardId: string;
  title: string;
  /** The plan alone ("Laptop") and the card it is on, for a table that names them in columns of their own. */
  description: string;
  cardName: string;
  /** The plan's monthly figure, in the card's currency. */
  monthlyMinor: number;
  currency: string;
  /** "3 of 12 paid · on the statement". */
  detail: string;
}

/**
 * The plans still running on a date, soonest finished first: those whose last month has not gone by. They are paid with
 * the card's statement and were counted when the purchase was made, so nothing here feeds Still to pay or any hero.
 */
export function instalmentLines(
  plans: readonly CardInstallmentRow[],
  cards: readonly { id: string; name: string; currency: string | null }[],
  baseCurrency: string,
  today: string,
  /** Each plan's instalments (`planInstalmentStatuses`): what it counts as paid, as the plan's own page does. */
  statuses: Readonly<Record<string, readonly PlanInstalmentStatus[]>> = {},
): InstalmentLine[] {
  const month = today.slice(0, 7);
  return plans
    .flatMap((plan) => {
      const card = cards.find((c) => c.id === plan.cardAccountId);
      const split = installmentSplit(plan, today);
      if (!card || split.lastMonth < month) return [];
      return [{ plan, split, card }];
    })
    .sort((a, b) => a.split.lastMonth.localeCompare(b.split.lastMonth) || a.plan.description.localeCompare(b.plan.description))
    .map(({ plan, split, card }) => ({
      id: plan.id,
      cardId: card.id,
      title: `${plan.description} · ${card.name}`,
      description: plan.description,
      cardName: card.name,
      monthlyMinor: plan.monthlyMinor,
      currency: card.currency ?? baseCurrency,
      detail: statuses[plan.id]
        ? `${statuses[plan.id]!.filter((row) => row.status === 'paid').length} of ${plan.months} paid · on the statement`
        : `${plan.months - split.monthsLeft} of ${plan.months} · on the statement`,
    }));
}
