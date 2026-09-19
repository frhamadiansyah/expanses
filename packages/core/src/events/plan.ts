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
  /** The purchase that answered it, and how much of that purchase this item is. */
  purchase: { transactionId: string; shareMinor: number } | null;
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
  /** True only when the purchase is in the scope being read: a tab can put an item back on the list. */
  bought: boolean;
  /** This item's share of the purchase — never the whole receipt. */
  actualMinor: number | null;
  occurredOn: string | null;
  description: string | null;
  /** Where the money actually landed, which is the item's own category unless it was changed at the till. */
  boughtInCategoryId: string | null;
  /** Share minus estimate. Positive is over. Null while it is not bought. */
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
    // An item is bought only when its purchase is in this reading: under a workspace tab the money may be elsewhere,
    // and then the honest answer is that it is still to buy here.
    const rows = item.purchase ? (byTransaction.get(item.purchase.transactionId) ?? []) : [];
    if (rows.length === 0) {
      return { ...item, estimateMinor, bought: false, actualMinor: null, occurredOn: null, description: null, boughtInCategoryId: null, differenceMinor: null };
    }
    // The biggest entry is the purchase's own category when it was split; for the ordinary purchase it is the only one.
    const main = [...rows].sort((a, b) => b.amountBaseMinor - a.amountBaseMinor || a.categoryId.localeCompare(b.categoryId))[0]!;
    return {
      ...item,
      estimateMinor,
      bought: true,
      actualMinor: item.purchase!.shareMinor,
      occurredOn: main.occurredOn,
      description: main.description,
      boughtInCategoryId: main.categoryId,
      differenceMinor: item.purchase!.shareMinor - estimateMinor,
    };
  });

  // What each purchase has already answered, so the rest of it can be read as spending nobody planned.
  const givenTo = new Map<string, number>();
  for (const view of views) {
    if (view.bought) givenTo.set(view.purchase!.transactionId, (givenTo.get(view.purchase!.transactionId) ?? 0) + view.actualMinor!);
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
  const boughtActualMinor = sum(bought.map((view) => view.actualMinor!));

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
    toBuyMinor: plannedMinor - boughtEstimateMinor,
    boughtEstimateMinor,
    boughtActualMinor,
    differenceMinor: boughtActualMinor - boughtEstimateMinor,
    // By subtraction, so what was spent always equals the items' shares plus what nobody planned — a part-allocated
    // receipt's remainder needs no special case to land here.
    notPlannedMinor: spentMinor - boughtActualMinor,
    overCount: bought.filter((view) => view.differenceMinor! > 0).length,
    lines,
  };
}
