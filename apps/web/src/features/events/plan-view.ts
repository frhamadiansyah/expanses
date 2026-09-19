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
  spent: 'Spent',
  overCount: (count) => `${count} ${count === 1 ? 'item' : 'items'} over`,
};

/** How the difference on an item or a plan is coloured. Beside the words it tones, so the two cannot drift apart. */
export const TONE = { over: 'text-red-700', under: 'text-emerald-700', exact: 'text-slate-500' } as const;

/**
 * The arc measures the categories that were planned, never the whole event.
 *
 * A trip with Rp18.400.000 tagged to it and Rp3.500.000 of tickets planned is not Rp14.900.000 over plan: the food was
 * never planned, so there is nothing for it to be over. The first chart page still shows every rupiah.
 */
export const gaugeFor = (plan: EventPlan): BudgetProgress => {
  /*
   * Through `planTotals`, which owns what a figure on these screens may be.
   *
   * The arc's middle is a figure on screen like any other: an event whose refunds outweigh what its planned
   * categories ever spent drew "Spent −Rp1.000.000" here while the Plan card printed Rp0 for that same quantity a
   * few lines below — one number, two answers, because each place clamped for itself or forgot to.
   */
  const totals = planTotals(plan);
  return { capsMinor: totals.plannedMinor, spentMinor: totals.plannedSpentMinor, overCount: plan.overCount, any: plan.hasPlan };
};

/**
 * "Planned so far" admits that the figure is not the whole trip.
 *
 * True the moment a category has money and no items — and true again, by a different route, whenever money came back
 * on a receipt of its own: a refund answers no item, so "Planned" would be claiming an account of the event's money
 * that the plan alone does not give. Asked of the money back rather than of the sign of a subtraction, so an event
 * whose refund is outweighed by other unplanned spending says it just as plainly as one whose refund is not.
 */
export const plannedLabel = (plan: EventPlan) => (plan.unplannedCategoryCount > 0 || planTotals(plan).moneyBackMinor > 0 ? 'Planned so far' : 'Planned');

/**
 * What the ring's middle figure is counting, said out loud whenever it is not the whole event.
 *
 * The chart on the first page adds up every rupiah tagged to the event; the ring on the second adds up only the
 * categories that have items, because those are the only ones a plan may be measured against. Where the two differ
 * a user swiping between them would otherwise meet two totals for one trip with nothing saying why — so the ring's
 * own figure is named for what it counts, and the page prints the chart's total beneath it under the chart's words.
 */
export const spentLabel = (plan: EventPlan) => (plan.spentMinor === plan.plannedSpentMinor ? 'Spent' : 'Spent on plan');

/**
 * What a clamped nought is hiding, in the "Money back" vocabulary these screens already file a refund under.
 *
 * Refunds tagged to an event can outrun the purchases tagged to it, and then a total is less than nothing. The rule
 * is both-sided — never print a negative, and never hide one either — so the figure is turned round and said as what
 * it is: money that came back. Two readings can go under by different routes, the whole event's and the ring's,
 * which counts the planned categories alone, so each is named for what it outran.
 */
export const BACK_WORDS = { event: 'More came back than went out', plan: 'More came back than the plan spent' } as const;

const lower = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);

/**
 * The quiet line under the chart's middle figure.
 *
 * Ordinarily how many payments that figure is made of. When more came back than the event ever spent the figure
 * above it is a clamped nought, and a nought nothing on the page explains is as wrong as the negative it replaced —
 * so the line says how much more came back, beside the very figure it accounts for.
 */
export function chartUnder(totals: { netBackMinor: number }, transactions: number, currency = 'IDR'): string | undefined {
  const counted = transactions > 0 ? `${transactions} transaction${transactions === 1 ? '' : 's'}` : null;
  const back = totals.netBackMinor > 0 ? `${formatMinor(totals.netBackMinor, currency)} ${lower(BACK_WORDS.event)}` : null;
  return [counted, back].filter(Boolean).join(' · ') || undefined;
}

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
  // The two figures an item cannot move come from the one place that reads them, so the form and the plan agree —
  // money back included, or this card would quietly drop a refund the plan screen names.
  const { notPlannedMinor, moneyBackMinor } = planTotals(plan);
  return {
    plannedMinor: Math.max(0, plan.plannedMinor - (old?.estimateMinor ?? 0) + typed.estimateMinor),
    // Editing something already bought does not put it back on the list of things to buy.
    toBuyMinor: Math.max(0, plan.toBuyMinor - (wasBought ? 0 : (old?.estimateMinor ?? 0)) + (wasBought ? 0 : typed.estimateMinor)),
    notPlannedMinor,
    moneyBackMinor,
  };
}

/**
 * The summary figures as a screen may show them: never below nought, and every line equal to the rows beneath it.
 *
 * `plan.notPlannedMinor` is spending minus the shares items claim — one subtraction over the whole event. Per
 * purchase it is the same subtraction, and the plan already does it: what is left of a receipt once its items have
 * had their shares. A purchase with something left becomes a leftover row under its category; a refund posted as its
 * *own* transaction has **less than nothing** left, so it becomes no row at all while still moving the total. The
 * event's subtraction is therefore the positive leftovers plus the negative ones, and those two are different things
 * that must be said separately:
 *
 *     notPlannedMinor  = Σ of the leftover rows the screen prints — money spent that no item claims
 *     moneyBackMinor   = −Σ of the negative ones — money that came back, which `moneyBackRows` names
 *
 * Taking `moneyBackMinor` as "whatever the clamp swallowed" instead reconciles only when a refund is the event's
 * *sole* unplanned money: with Rp1.000.000 back and Rp5.000.000 unplanned the clamp swallows nothing, so the refund
 * would be named nowhere and "Not planned" would read Rp4.000.000 above rows adding to Rp5.000.000; with Rp1.500.000
 * back and Rp800.000 unplanned it would head a row of Rp1.500.000 with the figure Rp700.000. Each line here is the
 * sum of its own rows in every arrangement, which is the only way a user can check one.
 *
 * The account still closes, because the positive and negative leftovers are the whole of the subtraction:
 *
 *     spent = shares of bought items + notPlannedMinor − moneyBackMinor
 *
 * Nothing here links a refund to an item: an item is answered by the purchase that bought it, and what a standalone
 * refund means to an occasion is a question the spec never asked. Naming it is the honest interim.
 *
 * The two totals the screens print are clamped here as well, with the amount each clamp swallowed handed back
 * beside it. Clamping in the screens instead is what let one quantity read two ways on one page: the ring drew a
 * negative while the card beside it drew nought, and the row that quotes the chart quoted nought for a chart
 * showing −Rp1.000.000. There is one definition of each, and `BACK_WORDS` is how a clamp gets said out loud.
 */
export function planTotals(plan: EventPlan) {
  // Exactly the rows `PlanPage` prints under each category: every purchase with something still left on it.
  const leftoverMinor = plan.lines.reduce((total, line) => total + line.unplannedMinor, 0);
  return {
    plannedMinor: Math.max(0, plan.plannedMinor),
    boughtActualMinor: Math.max(0, plan.boughtActualMinor),
    toBuyMinor: Math.max(0, plan.toBuyMinor),
    /** Every rupiah tagged to the event — the chart's own middle figure — and never less than nothing. */
    spentMinor: Math.max(0, plan.spentMinor),
    /** What the categories with items spent: the ring's middle figure, and the Plan card's header, clamped once. */
    plannedSpentMinor: Math.max(0, plan.plannedSpentMinor),
    /** What the clamp on the event's own total swallowed: how much more came back than the event ever spent. */
    netBackMinor: Math.max(0, -plan.spentMinor),
    /** The same for the ring, which counts the planned categories alone and can go under by a route of its own. */
    planNetBackMinor: Math.max(0, -plan.plannedSpentMinor),
    /** Money spent that no item claims — the leftover rows, and never a figure that has a refund netted off it. */
    notPlannedMinor: leftoverMinor,
    /** Money that came back and answers no item: the leftovers the plan files under no category because they are
     * less than nothing. `max` guards the arithmetic only; the rows can never add to more than the subtraction. */
    moneyBackMinor: Math.max(0, leftoverMinor - plan.notPlannedMinor),
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
