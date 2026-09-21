import type { CategoryAmount, CategoryNode } from '../reports/spending';
import type { CategoryNeed } from './needs';

/**
 * The monthly budget sheet: income, spending against its caps, debt payments and goal savings, with a
 * plan line and an actual line that are never merged.
 *
 * The tree is built here rather than with `categoryTree`, which prunes branches that spent nothing. A
 * budget sheet lists every expense category, because a category you never spend in is exactly the one
 * you want to see a cap sitting unused on.
 */

export interface BudgetCap {
  categoryId: string;
  amountMinor: number;
}

export interface SavingsRow {
  goalId: string;
  name: string;
  planMinor: number;
  actualMinor: number;
}

export interface BudgetLine {
  id: string;
  name: string;
  ownMinor: number;
  totalMinor: number;
  /** Null when this category carries no budget of its own. */
  capMinor: number | null;
  /** How far past the cap this line is, or 0. */
  overMinor: number;
  children: BudgetLine[];
}

export interface BudgetSheetInput {
  /** YYYY-MM. */
  month: string;
  categories: CategoryNode[];
  amounts: CategoryAmount[];
  /** The plan, with the month's overrides already applied. */
  caps: BudgetCap[];
  incomePlanMinor: number;
  incomeActualMinor: number;
  debtPaymentsPlanMinor: number;
  debtPaymentsActualMinor: number;
  savings: SavingsRow[];
  /**
   * Spending tagged to an event, which the caps deliberately do not see: a wedding would read as
   * every category blown at once, when the money was always meant to go. It is still subtracted from
   * what is left, because it did leave the account.
   */
  eventSpendingMinor: number;
  /**
   * Whether `amounts` already contains that event spending — the workspace's own decision. A business
   * workspace whose trips are the work wants them inside its caps; a household one does not. Required
   * rather than optional, so no caller can forget to say which of the two totals it passed.
   */
  eventsInCaps: boolean;
  /** Each category's resolved need. A category missing here counts as essential, as an unmarked one does. */
  needs?: Readonly<Record<string, CategoryNeed>>;
}

export interface BudgetSheet {
  month: string;
  lines: BudgetLine[];
  /** One row per goal, carried through so the sheet can list what each asks for. */
  savings: SavingsRow[];
  /** Only budgets with no budgeted ancestor, so a purchase is never counted twice. */
  capsTotalMinor: number;
  spendingActualMinor: number;
  /** What was spent in categories that resolve to essential (or carry no mark), signed. */
  essentialActualMinor: number;
  /** What was spent in categories that resolve to lifestyle, signed. The two add back to `spendingActualMinor`. */
  lifestyleActualMinor: number;
  /** What events cost this month: named either way, and inside the lines above only when `eventsInCaps`. */
  eventSpendingMinor: number;
  /** Carried through so a screen can say whether the lines above already contain the event line. */
  eventsInCaps: boolean;
  overCount: number;
  incomePlanMinor: number;
  incomeActualMinor: number;
  debtPaymentsPlanMinor: number;
  debtPaymentsActualMinor: number;
  savingsPlanMinor: number;
  savingsActualMinor: number;
  leftOverPlanMinor: number;
  leftOverActualMinor: number;
}

export function budgetSheet(input: BudgetSheetInput): BudgetSheet {
  const own = new Map<string, number>();
  for (const amount of input.amounts) own.set(amount.accountId, (own.get(amount.accountId) ?? 0) + amount.amountBaseMinor);

  const capOf = new Map<string, number>();
  for (const cap of input.caps) capOf.set(cap.categoryId, cap.amountMinor);

  const ids = new Set(input.categories.map((category) => category.id));
  const childrenOf = new Map<string | null, CategoryNode[]>();
  for (const category of input.categories) {
    // A category whose parent is missing hangs from the root, as the spending tree treats it.
    const parent = category.parentId !== null && ids.has(category.parentId) ? category.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(category);
    childrenOf.set(parent, list);
  }

  const build = (category: CategoryNode): BudgetLine => {
    const children = (childrenOf.get(category.id) ?? []).map(build).sort(byTotalThenName);
    const ownMinor = own.get(category.id) ?? 0;
    const totalMinor = children.reduce((total, child) => total + child.totalMinor, ownMinor);
    const capMinor = capOf.get(category.id) ?? null;
    return {
      id: category.id,
      name: category.name,
      ownMinor,
      totalMinor,
      capMinor,
      overMinor: capMinor !== null && totalMinor > capMinor ? totalMinor - capMinor : 0,
      children,
    };
  };

  const lines = (childrenOf.get(null) ?? []).map(build).sort(byTotalThenName);

  // A budget inside a budgeted branch is a tighter cap, not another pocket of money: only the
  // outermost cap in each branch belongs in the total.
  let capsTotalMinor = 0;
  let overCount = 0;
  const walk = (rows: BudgetLine[], insideBudget: boolean) => {
    for (const row of rows) {
      if (row.overMinor > 0) overCount += 1;
      const budgeted = row.capMinor !== null;
      if (budgeted && !insideBudget) capsTotalMinor += row.capMinor!;
      walk(row.children, insideBudget || budgeted);
    }
  };
  walk(lines, false);

  const spendingActualMinor = lines.reduce((total, line) => total + line.totalMinor, 0);
  // Signed, category by category, over exactly the categories the lines were built from; essential is the rest,
  // so the two always add back to what was spent.
  const lifestyleActualMinor = input.categories.reduce(
    (total, category) => (input.needs?.[category.id] === 'lifestyle' ? total + (own.get(category.id) ?? 0) : total),
    0,
  );
  const essentialActualMinor = spendingActualMinor - lifestyleActualMinor;
  const savingsPlanMinor = input.savings.reduce((total, row) => total + row.planMinor, 0);
  const savingsActualMinor = input.savings.reduce((total, row) => total + row.actualMinor, 0);

  return {
    month: input.month,
    lines,
    savings: input.savings,
    capsTotalMinor,
    spendingActualMinor,
    essentialActualMinor,
    lifestyleActualMinor,
    eventSpendingMinor: input.eventSpendingMinor,
    eventsInCaps: input.eventsInCaps,
    overCount,
    incomePlanMinor: input.incomePlanMinor,
    incomeActualMinor: input.incomeActualMinor,
    debtPaymentsPlanMinor: input.debtPaymentsPlanMinor,
    debtPaymentsActualMinor: input.debtPaymentsActualMinor,
    savingsPlanMinor,
    savingsActualMinor,
    leftOverPlanMinor: input.incomePlanMinor - capsTotalMinor - input.debtPaymentsPlanMinor - savingsPlanMinor,
    leftOverActualMinor:
      input.incomeActualMinor -
      spendingActualMinor -
      // When the workspace counts its events, they are already inside spendingActual: subtracting again would
      // charge the month for the same dinner twice.
      (input.eventsInCaps ? 0 : input.eventSpendingMinor) -
      input.debtPaymentsActualMinor -
      savingsActualMinor,
  };
}

const byTotalThenName = (a: BudgetLine, b: BudgetLine): number => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name);
