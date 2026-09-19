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

/**
 * "Planned so far" admits that the figure is not the whole trip.
 *
 * True the moment a category has money and no items — and true again, by a different route, when a refund posted as
 * its own transaction drives `notPlannedMinor` below nought: the event then holds a rupiah that belongs to no item
 * and to no leftover row either, so "Planned" would be claiming an account of the money that does not close.
 */
export const plannedLabel = (plan: EventPlan) => (plan.unplannedCategoryCount > 0 || plan.notPlannedMinor < 0 ? 'Planned so far' : 'Planned');

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

/**
 * What the plan reads as once this item is saved. Shown live under the new-item form.
 *
 * Every figure comes back through `Math.max(0, …)`, here rather than in each screen: a half-typed price makes the
 * estimate nought for a keystroke, an edit can take an estimate down, and a standalone refund can put
 * `notPlannedMinor` below nought — and a screen that had to remember the clamp for itself would be four screens each
 * remembering it separately. Nothing on a plan is ever less than nothing.
 */
export function afterSaving(plan: EventPlan, typed: { estimateMinor: number; replacing?: string }) {
  const old = plan.lines.flatMap((line) => line.items).find((item) => item.id === typed.replacing);
  const wasBought = old?.bought === true;
  return {
    plannedMinor: Math.max(0, plan.plannedMinor - (old?.estimateMinor ?? 0) + typed.estimateMinor),
    // Editing something already bought does not put it back on the list of things to buy.
    toBuyMinor: Math.max(0, plan.toBuyMinor - (wasBought ? 0 : (old?.estimateMinor ?? 0)) + (wasBought ? 0 : typed.estimateMinor)),
    notPlannedMinor: Math.max(0, plan.notPlannedMinor),
  };
}

/**
 * The summary figures as a screen may show them: never below nought, and never quietly.
 *
 * `notPlannedMinor` is spending minus the shares items claim, and a refund posted as its *own* transaction and tagged
 * to the event takes money off the spending without touching any share — so the subtraction can go below nought. A
 * negative "Not planned for" is unreadable (money nobody planned cannot be less than nothing), and simply clamping it
 * would hide the refund inside a figure that no longer adds up. So it is clamped **and** what the clamp swallowed is
 * handed back as `moneyBackMinor`, for the screen to name on a line of its own beside the purchases it came off.
 *
 * The account still closes, and this is the arithmetic that closes it:
 *
 *     spent = shares of bought items + notPlannedMinor − moneyBackMinor
 *
 * `moneyBackMinor` is the whole of the correction — it is the clamped-away remainder and nothing else — so a screen
 * that shows it beside the two figures either side of it is showing the user every rupiah the event holds. The plan's
 * own leftover rows cannot do this job: that loop skips a purchase with `left <= 0`, and a refund has less than
 * nothing left, so it appears in no row while moving every total. `moneyBackRows` names which purchases they were.
 *
 * Nothing here links a refund to an item: an item is answered by the purchase that bought it, and what a standalone
 * refund means to an occasion is a question the spec never asked. Naming it is the honest interim.
 */
export function planTotals(plan: EventPlan) {
  const notPlanned = Math.max(0, plan.notPlannedMinor);
  return {
    plannedMinor: Math.max(0, plan.plannedMinor),
    boughtActualMinor: Math.max(0, plan.boughtActualMinor),
    toBuyMinor: Math.max(0, plan.toBuyMinor),
    notPlannedMinor: notPlanned,
    /** What the clamp is holding back: money that came back and answers no item. Nought when nothing is held back. */
    moneyBackMinor: Math.max(0, -plan.notPlannedMinor),
  };
}

/** Only the shape these rows are read through: the plan does not care what else a transaction carries. */
export interface TaggedPurchase {
  id: string;
  occurredOn: string;
  description: string;
  entries: readonly { accountKind: string; amountBaseMinor: number }[];
}

/**
 * The transactions tagged to the event that gave money back rather than spending it, each with what came back.
 *
 * The plan's own leftover rows cannot carry these: a purchase with nothing left on it is skipped there, and a refund
 * has less than nothing left. Without this they would move every total on the page and appear on none of it.
 */
export function moneyBackRows(purchases: readonly TaggedPurchase[]) {
  return purchases
    .map((purchase) => ({
      transactionId: purchase.id,
      occurredOn: purchase.occurredOn,
      description: purchase.description,
      // Signed the other way round on purpose: what came back is a positive figure on screen.
      amountMinor: -purchase.entries.filter((entry) => entry.accountKind === 'expense').reduce((total, entry) => total + entry.amountBaseMinor, 0),
    }))
    .filter((row) => row.amountMinor > 0)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
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
