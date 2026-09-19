import { dayMonth, type EventPlan, type EventPlanItemView, formatMinor } from '@expanses/core';
import type { GaugeWords } from '../transactions/BudgetGauge';
import type { BudgetProgress } from '../transactions/budget-progress';

/*
 * The plan as the screens read it: no JSX here, so every word and every figure the event page shows can be tested
 * without rendering anything. The currency is a parameter defaulting to the owner's, so these stay pure functions.
 *
 * The card is called "Plan" and never "Budget": budgets are the monthly caps on the Budget page, and an occasion's
 * list of things to buy is a different thing that must not borrow their word.
 */

/** A month has budgets; an event has a plan, and the plan is a list of things. */
export const PLAN_WORDS: GaugeWords = {
  left: 'Left of the plan',
  over: 'Over the plan by',
  set: 'Planned',
  overCount: (count) => `${count} ${count === 1 ? 'item' : 'items'} over`,
};

/**
 * The arc measures the categories that were planned, never the whole event.
 *
 * A trip with Rp18.400.000 tagged to it and Rp3.500.000 of tickets planned is not Rp14.900.000 over plan: the food was
 * never planned, so there is nothing for it to be over. The first chart page still shows every rupiah.
 */
export const gaugeFor = (plan: EventPlan): BudgetProgress => ({
  capsMinor: plan.plannedMinor,
  spentMinor: plan.plannedSpentMinor,
  overCount: plan.overCount,
  any: plan.hasPlan,
});

/** "Planned so far" admits that the figure is not the whole trip, which is true the moment a category has no items. */
export const plannedLabel = (plan: EventPlan) => (plan.unplannedCategoryCount > 0 ? 'Planned so far' : 'Planned');

/**
 * What one item cost against what it was estimated at, said in words and in a tone.
 *
 * The minus sign is U+2212, as the mockup uses — a hyphen next to a currency symbol reads as a dash rather than as
 * a sign. The tones are named rather than coloured: the screens map them to classes, so the words stay testable.
 */
export function differenceWords(minor: number, currency = 'IDR'): { text: string; tone: 'over' | 'under' | 'exact' } {
  if (minor === 0) return { text: 'exactly', tone: 'exact' };
  return { text: `${minor > 0 ? '+' : '−'}${formatMinor(Math.abs(minor), currency)}`, tone: minor > 0 ? 'over' : 'under' };
}

/** "6 × Rp500.000", or nothing at all: one of something needs no arithmetic shown. */
export const quantityWords = (item: EventPlanItemView, currency = 'IDR') =>
  item.quantity > 1 ? `${item.quantity} × ${formatMinor(item.unitPriceMinor, currency)}` : null;

/** The line under an item's name: what it is expected to cost, or where and when it was actually bought. */
export function itemSubline(item: EventPlanItemView, currency = 'IDR'): string {
  const state = item.bought && item.occurredOn ? `${item.description} · ${dayMonth(item.occurredOn)}` : 'estimate';
  const many = quantityWords(item, currency);
  return many ? `${many} · ${state}` : state;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** One row per planned category on the event page's Plan card. Categories with no items are not part of the plan. */
export function planCardRows(plan: EventPlan) {
  return plan.lines
    .filter((line) => line.planned)
    .map((line) => ({
      categoryId: line.categoryId,
      name: line.name,
      plannedMinor: line.plannedMinor,
      subline: `${plural(line.itemCount, 'item')} · ${line.boughtCount === 0 ? 'none bought' : `${line.boughtCount} bought`}`,
    }));
}

/** Every category, planned or not: this is the page that must never hide what was spent. */
export function whereItWentRows(plan: EventPlan) {
  return plan.lines.map((line) => ({
    categoryId: line.categoryId,
    name: line.name,
    actualMinor: line.actualMinor,
    plannedMinor: line.plannedMinor,
    planned: line.planned,
    subline: line.purchaseCount === 0 ? 'nothing spent yet' : plural(line.purchaseCount, 'purchase'),
  }));
}

/** The events list: a planned event says what is still to buy, an unplanned one how many purchases it holds. */
export function eventListLine(plan: EventPlan, currency = 'IDR') {
  if (!plan.hasPlan) {
    return { subline: `No plan · ${plural(plan.purchaseCount, 'purchase')}`, amountMinor: plan.spentMinor, ofMinor: null as number | null };
  }
  return {
    subline: `Planned · ${formatMinor(plan.toBuyMinor, currency)} still to buy`,
    amountMinor: plan.plannedSpentMinor,
    ofMinor: plan.plannedMinor,
  };
}

/** What the plan reads as once this item is saved. Shown live under the new-item form. */
export function afterSaving(plan: EventPlan, typed: { estimateMinor: number; replacing?: string }) {
  const old = plan.lines.flatMap((line) => line.items).find((item) => item.id === typed.replacing);
  const wasBought = old?.bought === true;
  return {
    plannedMinor: plan.plannedMinor - (old?.estimateMinor ?? 0) + typed.estimateMinor,
    // Editing something already bought does not put it back on the list of things to buy.
    toBuyMinor: plan.toBuyMinor - (wasBought ? 0 : (old?.estimateMinor ?? 0)) + (wasBought ? 0 : typed.estimateMinor),
    notPlannedMinor: plan.notPlannedMinor,
  };
}

/**
 * The three figures at the foot of "What it covers". `over` turns Save off rather than letting the write refuse.
 *
 * This is the screen a receipt answering several items belongs on: ticking an item off claims what is left of its
 * receipt, so the second tick on a shared one finds nothing there. Here every share is typed together and checked
 * against the one receipt before anything is written.
 */
export function coverTotals(totalMinor: number, shares: readonly number[]) {
  const givenMinor = shares.reduce((total, share) => total + share, 0);
  return { totalMinor, givenMinor, leftMinor: totalMinor - givenMinor, over: givenMinor > totalMinor };
}
