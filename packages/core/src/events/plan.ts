/**
 * An event's plan, and what it actually cost.
 *
 * A plan is a list of things to buy — how many of each and roughly what one costs — not a set of budgets. Nothing is
 * set per category: a category line is only what its items add up to, which is why no two figures here can disagree.
 * A plan is also per category rather than per event: an event may plan the tickets and not the food, and the figures
 * below are careful never to measure unplanned spending against a plan that was never meant to cover it.
 */

export interface EventPlanItemInput {
  id: string;
  name: string;
  /** How many of the thing. One is the ordinary case. */
  quantity: number;
  unitPriceMinor: number;
  categoryId: string | null;
  link: string | null;
  note: string | null;
  /**
   * The purchases that paid for it, each with how much of that purchase this item is. An item may be paid for several
   * times — souvenirs from three shops — and one purchase may answer several items.
   */
  purchases: readonly { transactionId: string; shareMinor: number }[];
  /** Marked done: nothing more is to be bought for it. Until then it stays on the list, whatever was paid. */
  done: boolean;
}

/** One expense entry of one posted transaction tagged to the event, in the scope being read. */
export interface EventActual {
  transactionId: string;
  occurredOn: string;
  description: string;
  categoryId: string;
  amountBaseMinor: number;
}

export interface EventPlanInput {
  items: EventPlanItemInput[];
  actuals: EventActual[];
  /** Names for the categories either side mentions, so a line can be read. */
  categoryNames: Record<string, string>;
}

export interface EventPlanItemView extends EventPlanItemInput {
  /** Quantity times price each, in minor units. Derived, never stored: two integers cannot round. */
  estimateMinor: number;
  /**
   * Done, and — when it was paid for at all — paid for in the scope being read: a tab can put an item back on the list.
   */
  bought: boolean;
  /** The largest purchase in this reading, for the screens that name one; null when none is. */
  purchase: { transactionId: string; shareMinor: number } | null;
  /** How many of its purchases are in this reading. */
  purchaseCount: number;
  /** What its purchases in this reading add up to — its shares of them, never the whole receipts. Null when none. */
  actualMinor: number | null;
  occurredOn: string | null;
  description: string | null;
  /** Where the money actually landed, which is the item's own category unless it was changed at the till. */
  boughtInCategoryId: string | null;
  /** What was paid minus the estimate. Positive is over. Null while it is not bought. */
  differenceMinor: number | null;
}

/** Money on the event that no item claims: a whole purchase, or what is left of a part-allocated one. */
export interface EventPlanUnplanned {
  transactionId: string;
  occurredOn: string;
  description: string;
  amountBaseMinor: number;
  /** True when some of this purchase did answer items and this is only the remainder. */
  partial: boolean;
}

export interface EventPlanLine {
  /** Null on the line holding items filed in no category. */
  categoryId: string | null;
  name: string;
  /** True when this category has at least one item: it is the category that is planned, not the event. */
  planned: boolean;
  plannedMinor: number;
  actualMinor: number;
  itemCount: number;
  boughtCount: number;
  purchaseCount: number;
  items: EventPlanItemView[];
  unplanned: EventPlanUnplanned[];
  unplannedMinor: number;
}

export interface EventPlan {
  hasPlan: boolean;
  itemCount: number;
  boughtCount: number;
  purchaseCount: number;
  unplannedCategoryCount: number;
  plannedMinor: number;
  spentMinor: number;
  /** What was spent in the categories that have items — what the plan may honestly be measured against. */
  plannedSpentMinor: number;
  toBuyMinor: number;
  boughtEstimateMinor: number;
  boughtActualMinor: number;
  /** Signed: positive is over estimate, negative under, nought exact. */
  differenceMinor: number;
  notPlannedMinor: number;
  overCount: number;
  lines: EventPlanLine[];
}

/** What items with no category are filed under. */
const NO_CATEGORY = 'No category';

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function eventPlan(input: EventPlanInput): EventPlan {
  const byTransaction = new Map<string, EventActual[]>();
  for (const row of input.actuals) byTransaction.set(row.transactionId, [...(byTransaction.get(row.transactionId) ?? []), row]);

  const views: EventPlanItemView[] = input.items.map((item) => {
    const estimateMinor = item.quantity * item.unitPriceMinor;
    // Only the purchases in this reading count: under a workspace tab the money may be elsewhere.
    const here = item.purchases.filter((purchase) => byTransaction.has(purchase.transactionId));
    const paid = here.length > 0 ? sum(here.map((purchase) => purchase.shareMinor)) : null;
    // Done, and paid for here when it was paid for at all: an item done on money read under another tab is still to buy here.
    const bought = item.done && (item.purchases.length === 0 || here.length > 0);
    const largest = [...here].sort((a, b) => b.shareMinor - a.shareMinor || a.transactionId.localeCompare(b.transactionId))[0] ?? null;
    // The latest purchase names the day and the shop; its biggest entry is where the money landed.
    const latest = here
      .map((purchase) => byTransaction.get(purchase.transactionId)!)
      .map((rows) => [...rows].sort((a, b) => b.amountBaseMinor - a.amountBaseMinor || a.categoryId.localeCompare(b.categoryId))[0]!)
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))[0];
    return {
      ...item,
      estimateMinor,
      bought,
      purchase: largest,
      purchaseCount: here.length,
      actualMinor: paid,
      occurredOn: latest?.occurredOn ?? null,
      description: latest?.description ?? null,
      boughtInCategoryId: latest?.categoryId ?? null,
      differenceMinor: bought ? (paid ?? 0) - estimateMinor : null,
    };
  });

  // What each purchase has already answered, so the rest of it can be read as spending nobody planned.
  const givenTo = new Map<string, number>();
  for (const view of views) {
    for (const purchase of view.purchases) {
      if (byTransaction.has(purchase.transactionId)) givenTo.set(purchase.transactionId, (givenTo.get(purchase.transactionId) ?? 0) + purchase.shareMinor);
    }
  }

  /** One row per purchase with something left on it, filed under its largest entry. */
  const leftovers = new Map<string, EventPlanUnplanned[]>();
  for (const [transactionId, rows] of byTransaction) {
    const total = sum(rows.map((row) => row.amountBaseMinor));
    const given = givenTo.get(transactionId) ?? 0;
    const left = total - given;
    if (left <= 0) continue;
    const main = [...rows].sort((a, b) => b.amountBaseMinor - a.amountBaseMinor || a.categoryId.localeCompare(b.categoryId))[0]!;
    leftovers.set(main.categoryId, [
      ...(leftovers.get(main.categoryId) ?? []),
      { transactionId, occurredOn: main.occurredOn, description: main.description, amountBaseMinor: left, partial: given > 0 },
    ]);
  }

  const bought = views.filter((view) => view.bought);
  const plannedMinor = sum(views.map((view) => view.estimateMinor));
  const spentMinor = sum(input.actuals.map((row) => row.amountBaseMinor));
  const boughtEstimateMinor = sum(bought.map((view) => view.estimateMinor));
  // Every payment towards the plan, the items still open included: it is what the plan has spent so far.
  const boughtActualMinor = sum(views.map((view) => view.actualMinor ?? 0));
  // What the open items still want: each one's estimate less what was already paid towards it, never below nothing.
  const toBuyMinor = sum(views.filter((view) => !view.bought).map((view) => Math.max(0, view.estimateMinor - (view.actualMinor ?? 0))));

  const categoryIds = [...new Set<string | null>([...views.map((view) => view.categoryId), ...input.actuals.map((row) => row.categoryId)])];
  const lines: EventPlanLine[] = categoryIds
    .map((categoryId) => {
      const mine = views.filter((view) => view.categoryId === categoryId);
      const money = categoryId === null ? [] : input.actuals.filter((row) => row.categoryId === categoryId);
      const unplanned = (categoryId === null ? [] : (leftovers.get(categoryId) ?? [])).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
      return {
        categoryId,
        name: categoryId === null ? NO_CATEGORY : (input.categoryNames[categoryId] ?? categoryId),
        // A category is planned when it has items — not because the event has a plan somewhere else.
        planned: mine.length > 0,
        plannedMinor: sum(mine.map((view) => view.estimateMinor)),
        actualMinor: sum(money.map((row) => row.amountBaseMinor)),
        itemCount: mine.length,
        boughtCount: mine.filter((view) => view.bought).length,
        purchaseCount: new Set(money.map((row) => row.transactionId)).size,
        // What is still to do comes first; the order within each half is the order the items were added in.
        items: [...mine.filter((view) => !view.bought), ...mine.filter((view) => view.bought)],
        unplanned,
        unplannedMinor: sum(unplanned.map((row) => row.amountBaseMinor)),
      };
    })
    .sort((a, b) =>
      // The line with no category is where things end up, not where the plan starts, so it sits last whatever it holds.
      a.categoryId === null ? 1 : b.categoryId === null ? -1 : b.plannedMinor - a.plannedMinor || b.actualMinor - a.actualMinor || a.name.localeCompare(b.name),
    );

  return {
    hasPlan: views.length > 0,
    itemCount: views.length,
    boughtCount: bought.length,
    purchaseCount: byTransaction.size,
    unplannedCategoryCount: lines.filter((line) => !line.planned && line.actualMinor > 0).length,
    plannedMinor,
    spentMinor,
    // Only the categories that were planned: measuring a trip's food against tickets nobody planned would call every
    // unplanned rupiah "over the plan", which is false.
    plannedSpentMinor: sum(lines.filter((line) => line.planned).map((line) => line.actualMinor)),
    toBuyMinor,
    boughtEstimateMinor,
    boughtActualMinor,
    // Only what is done is measured against its estimate: an open item's payments so far are not yet its cost.
    differenceMinor: sum(bought.map((view) => view.differenceMinor!)),
    // By subtraction, so what was spent always equals the items' shares plus what nobody planned — a part-allocated
    // receipt's remainder needs no special case to land here.
    notPlannedMinor: spentMinor - boughtActualMinor,
    overCount: bought.filter((view) => view.differenceMinor! > 0).length,
    lines,
  };
}
