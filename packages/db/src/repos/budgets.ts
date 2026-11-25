import {
  averageMonthlyMinor,
  BILL_DAY_KEY,
  BUDGET_FREQUENCIES,
  type BudgetFrequency,
  budgetMonthMinor,
  type BudgetPeriod,
  type BudgetRepeat,
  type BudgetShare,
  isCardCashbackKey,
  isCountedRepeat,
  isUncategorisedKey,
  isWeeksEvery,
  monthPeriod,
  resolveCaps,
  uuidv7,
} from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { accounts } from '../schema';
import { budgetOverrides, budgets, budgetShares } from '../schema-budget';
import { budgetFrequencies } from '../schema-health';
import { bookOfCategory, hasBooks } from './books';
import { budgetRepeatColumnsExist, healthTablesExist } from './health-tables';
import { weeklyBillDatesIn, type WeeklyBillDates } from './expense-templates';
import { monthStartFor } from './month-start';
import { phonesBehindBudgetRepeat } from '../sync/weekly-bills';
import { budgetSharesExist } from './share-tables';
import { getBudgetIncome } from './budget-settings';
import { bookMoneyFor } from './book-currency';
import { withCapture } from '../sync/capture';

export class BudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The category the refusal is about, when several were being saved at once. */
    readonly categoryAccountId?: string,
  ) {
    super(message);
    this.name = 'BudgetError';
  }
}

export interface SaveBudgetInput {
  categoryAccountId: string;
  /** The amount as typed, in the unit `frequency` names. Monthly when no unit is given. */
  amountMinor: number;
  frequency?: BudgetFrequency;
  /** A week's gap in weeks, 1 to 8 (Budget C); none, or 1, is every week. Only a week takes one. */
  everyWeeks?: number | null;
  /** YYYY-MM-DD: the day every few weeks (2 or more) is counted from. Required then, and only then. */
  startsOn?: string | null;
  /** Set as a % of take-home or of its parent: `amountMinor` is then the share resolved now, which amount_minor keeps. */
  share?: BudgetShare | null;
}

export interface SetOverrideInput {
  categoryAccountId: string;
  month: string;
  amountMinor: number;
}

export interface BudgetRow {
  id: string;
  categoryAccountId: string;
  /**
   * What the plan says for this month — for a %, resolved against this month's take-home or parent; for a day or a week,
   * the amount as typed × the times it comes up in this month (Budget C).
   */
  planMinor: number;
  /** What this month asks for: the override when there is one, otherwise the plan. */
  amountMinor: number;
  overridden: boolean;
  /** The unit the plan was typed in, and the amount as typed. Monthly, and the plan itself, when set monthly. */
  frequency: BudgetFrequency;
  amountAsSetMinor: number;
  /** A week's gap in weeks: 1 for every week, null for any other unit. */
  everyWeeks: number | null;
  /** YYYY-MM-DD: the day every few weeks is counted from; null unless it is every 2 weeks or more. */
  startsOn: string | null;
  /** Set as a % of take-home or of its parent; null for an amount. */
  share: BudgetShare | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH.test(month)) throw new BudgetError('BAD_MONTH', `"${month}" is not a month; write it as YYYY-MM`);
}

function assertWholeMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new BudgetError('NOT_WHOLE', 'An amount must be a whole number of minor units');
}

/**
 * Why a category cannot carry a budget or a need mark, or null when it can: a spending category of this workspace,
 * filed in the open book. One reader for both entry points (`saveBudget`, `saveCategoryNeed`).
 */
export async function spendingCategoryRefusal(db: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK' | null> {
  const [account] = await db
    .select({ kind: accounts.kind, subtype: accounts.subtype, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.id, categoryAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return 'NOT_FOUND';
  if (account.subtype !== 'category' || account.kind !== 'expense') return 'NOT_A_CATEGORY';
  // Uncategorised only holds what waits for a category: a cap on it would budget for not choosing one.
  if (isUncategorisedKey(account.systemKey)) return 'NOT_A_CATEGORY';
  // Cashback & Rewards into a credit card is money back, never spending to cap or to call essential or lifestyle.
  if (isCardCashbackKey(account.systemKey)) return 'NOT_A_CATEGORY';
  return (await otherBook(db, ws, categoryAccountId)) ? 'OTHER_BOOK' : null;
}

/**
 * A cap is read back by the workspace that set it, so it may only be set on a category that workspace holds:
 * one filed elsewhere would be saved and then never shown again. False when no workspace is open (the whole
 * workspace is being read) and on a database from before books existed.
 */
async function otherBook(db: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<boolean> {
  if (!ws.bookId || !(await hasBooks(db))) return false;
  const owner = await bookOfCategory(db, categoryAccountId);
  return owner !== null && owner !== ws.bookId;
}

const OTHER_BOOK_MESSAGE = 'That category belongs to another workspace';

async function assertInOpenBook(database: Database, ws: WorkspaceContext, categoryAccountId: string): Promise<void> {
  if (await otherBook(database.db, ws, categoryAccountId)) throw new BudgetError('OTHER_BOOK', OTHER_BOOK_MESSAGE);
}

const REFUSED: Record<'NOT_FOUND' | 'NOT_A_CATEGORY' | 'OTHER_BOOK', string> = {
  NOT_FOUND: 'That category does not exist in this workspace',
  NOT_A_CATEGORY: 'A budget belongs on a spending category',
  OTHER_BOOK: OTHER_BOOK_MESSAGE,
};

/** A budget belongs on a spending category, never on an account money sits in. */
async function assertCategory(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  const refusal = await spendingCategoryRefusal(database.db, ws, accountId);
  if (refusal) throw new BudgetError(refusal, REFUSED[refusal]);
}

/** A budget as it is written: its average month, and how it repeats. */
interface Checked {
  monthlyMinor: number;
  frequency: BudgetFrequency;
  /** Kept only for every 2 weeks or more; null is every week, or any other unit. */
  everyWeeks: number | null;
  startsOn: string | null;
}

const realDay = (date: string) => BILL_DAY_KEY.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

/** A budget's figure as a month, checked; the refusals every way of saving a budget shares. */
function checkedMonthly(input: SaveBudgetInput): Checked {
  assertWholeMinor(input.amountMinor);
  if (input.share) {
    const { basis, bp } = input.share;
    if (!Number.isInteger(bp) || bp < 1 || bp > 10000) throw new BudgetError('BAD_SHARE', 'A share is more than 0% and at most 100%');
    if ((input.frequency ?? 'monthly') !== 'monthly') throw new BudgetError('BAD_FREQUENCY', "A share is a month's figure");
    // A share that comes to nothing has nothing to be a share of.
    if (input.amountMinor <= 0 && basis === 'take-home') throw new BudgetError('NO_TAKE_HOME', 'Set a take-home first');
    if (input.amountMinor <= 0) throw new BudgetError('NO_PARENT_CAP', 'Its parent has no budget to take a share of');
  }
  if (input.amountMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'A budget must be above zero; remove it instead');
  const frequency = input.frequency ?? 'monthly';
  if (!BUDGET_FREQUENCIES.includes(frequency)) throw new BudgetError('BAD_FREQUENCY', `${String(frequency)} is not a unit a budget can be set in`);
  const every = input.everyWeeks ?? 1;
  if (frequency !== 'weekly' && every !== 1) throw new BudgetError('BAD_REPEAT', 'Only a week repeats every few weeks');
  if (frequency === 'weekly' && !isWeeksEvery(every)) throw new BudgetError('BAD_REPEAT', 'A budget repeats every 1 to 8 weeks');
  const everyWeeks = frequency === 'weekly' && every > 1 ? every : null;
  if (everyWeeks !== null && !(input.startsOn && realDay(input.startsOn))) throw new BudgetError('NO_START', 'Choose the day it starts');
  // Converted once, here: the average month. Every reader of budgets.amount_minor that does not count a month's days
  // (an older build, a book changing its money) goes on reading a month.
  const monthlyMinor = averageMonthlyMinor(input.amountMinor, frequency, everyWeeks);
  if (monthlyMinor <= 0) throw new BudgetError('AMOUNT_RANGE', 'That comes to nothing a month; set it higher or choose a shorter period');
  return { monthlyMinor, frequency, everyWeeks, startsOn: everyWeeks !== null ? input.startsOn! : null };
}

/**
 * A budget by days or weeks is read by Budget C's count (BUDGET_REPEAT_MIN_APP_VERSION): one becomes so, or changes how
 * it repeats, only while no other phone sharing its workspace is on an older build. An amount changed on a budget
 * that already repeats this way is saved as ever.
 */
async function assertPhonesCount(tx: Tx, ws: WorkspaceContext, input: SaveBudgetInput, checked: Checked): Promise<void> {
  if (!isCountedRepeat(checked) || !(await healthTablesExist(tx))) return;
  const repeat = await budgetRepeatColumnsExist(tx);
  const [before] = await tx.values<[string, number | null, string | null]>(
    repeat
      ? sql`SELECT f.frequency, f.every_weeks, f.starts_on FROM budget_frequencies f JOIN budgets b ON b.id = f.budget_id
            WHERE b.workspace_id = ${ws.workspaceId} AND b.category_account_id = ${input.categoryAccountId}`
      : sql`SELECT f.frequency, NULL, NULL FROM budget_frequencies f JOIN budgets b ON b.id = f.budget_id
            WHERE b.workspace_id = ${ws.workspaceId} AND b.category_account_id = ${input.categoryAccountId}`,
  );
  if (before && before[0] === checked.frequency && (before[1] ?? null) === checked.everyWeeks && (before[2] ?? null) === checked.startsOn) return;
  const owner = (await hasBooks(tx)) ? await bookOfCategory(tx, input.categoryAccountId) : null;
  const behind = owner ? await phonesBehindBudgetRepeat(tx, owner) : [];
  if (behind.length > 0) {
    throw new BudgetError('REPEAT_PHONES_BEHIND', `Update cicis on ${behind.join(' and ')} first: an older version cannot read a budget by days or weeks.`, input.categoryAccountId);
  }
}

/** Writes one checked budget inside a transaction already open; its id back. */
async function writeBudget(tx: Tx, ws: WorkspaceContext, input: SaveBudgetInput, checked: Checked, now: string): Promise<string> {
  const { monthlyMinor, frequency } = checked;
  await assertPhonesCount(tx, ws, input, checked);
  const [existing] = await tx
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
  const id = existing?.id ?? uuidv7();
  await withCapture(tx, [{ entity: 'budget', id }, { entity: 'budget_frequency', id }, { entity: 'budget_share', id }], async () => {
    if (existing) {
      await tx.update(budgets).set({ amountMinor: monthlyMinor, updatedAt: now }).where(eq(budgets.id, id));
    } else {
      await tx.insert(budgets).values({
        id,
        workspaceId: ws.workspaceId,
        categoryAccountId: input.categoryAccountId,
        amountMinor: monthlyMinor,
        createdAt: now,
        updatedAt: now,
      });
    }
    // Monthly is the absence of a row. Without 0053 the monthly figure is all that is kept, which is still the right money.
    if (await healthTablesExist(tx)) {
      await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, id));
      if (frequency !== 'monthly' && (await budgetRepeatColumnsExist(tx))) {
        await tx.run(sql`INSERT INTO budget_frequencies (budget_id, workspace_id, frequency, amount_as_set_minor, every_weeks, starts_on)
          VALUES (${id}, ${ws.workspaceId}, ${frequency}, ${input.amountMinor}, ${checked.everyWeeks}, ${checked.startsOn})`);
      } else if (frequency !== 'monthly') {
        if (checked.everyWeeks !== null) throw new BudgetError('NO_REPEAT', 'This database cannot repeat a budget every few weeks yet');
        await tx.run(sql`INSERT INTO budget_frequencies (budget_id, workspace_id, frequency, amount_as_set_minor) VALUES (${id}, ${ws.workspaceId}, ${frequency}, ${input.amountMinor})`);
      }
    }
    // An amount is the absence of a row, so saving an amount over a share clears it.
    if (await budgetSharesExist(tx)) {
      await tx.delete(budgetShares).where(eq(budgetShares.budgetId, id));
      if (input.share) await tx.insert(budgetShares).values({ budgetId: id, workspaceId: ws.workspaceId, basis: input.share.basis, shareBp: input.share.bp });
    }
  });
  return id;
}

/** A % of a parent needs a parent with a budget: checked once every row of a call is written, so a parent saved in the same go counts. */
async function assertParentsCapped(tx: Tx, ws: WorkspaceContext, inputs: readonly SaveBudgetInput[]): Promise<void> {
  for (const input of inputs) {
    if (input.share?.basis !== 'parent') continue;
    const [category] = await tx.select({ parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, input.categoryAccountId));
    const parentId = category?.parentId ?? null;
    const [parent] = parentId
      ? await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, parentId)))
      : [];
    if (!parent) throw new BudgetError('NO_PARENT_CAP', 'Its parent has no budget to take a share of', input.categoryAccountId);
  }
}

/**
 * Each category's plan in `month`, resolved: what a %-child keeps when the parent it was a share of goes. The month is
 * the one on screen, so the figure kept is the one the warning named; a month's own figure (an override) never is.
 */
async function planFiguresOf(database: Database, ws: WorkspaceContext, month: string): Promise<Map<string, number>> {
  return new Map((await listBudgets(database, ws, month)).map((row) => [row.categoryAccountId, row.planMinor]));
}

/**
 * Deletes one category's budget and every override that only made sense against it, inside an open transaction. Its
 * children that were a % of it become amounts at their figure now (`figures`), in the same go.
 */
async function deleteBudget(tx: Tx, ws: WorkspaceContext, categoryAccountId: string, figures: ReadonlyMap<string, number>): Promise<void> {
  const [existing] = await tx
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, categoryAccountId)));
  if (!existing) return;
  const shares = await budgetSharesExist(tx);
  const children = shares
    ? await tx
        .select({ budgetId: budgets.id, categoryAccountId: budgets.categoryAccountId })
        .from(budgets)
        .innerJoin(budgetShares, eq(budgetShares.budgetId, budgets.id))
        .innerJoin(accounts, eq(accounts.id, budgets.categoryAccountId))
        .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgetShares.basis, 'parent'), eq(accounts.parentId, categoryAccountId)))
    : [];
  const targets = [
    { entity: 'budget', id: existing.id },
    { entity: 'budget_frequency', id: existing.id },
    { entity: 'budget_share', id: existing.id },
    { entity: 'budget_override' },
    ...children.flatMap((child) => [
      { entity: 'budget', id: child.budgetId },
      { entity: 'budget_share', id: child.budgetId },
    ]),
  ];
  await withCapture(tx, targets, async () => {
    for (const child of children) {
      const figure = figures.get(child.categoryAccountId);
      if (figure !== undefined && figure > 0) await tx.update(budgets).set({ amountMinor: figure, updatedAt: new Date().toISOString() }).where(eq(budgets.id, child.budgetId));
      await tx.delete(budgetShares).where(eq(budgetShares.budgetId, child.budgetId));
    }
    if (shares) await tx.delete(budgetShares).where(eq(budgetShares.budgetId, existing.id));
    if (await healthTablesExist(tx)) await tx.delete(budgetFrequencies).where(eq(budgetFrequencies.budgetId, existing.id));
    await tx.delete(budgetOverrides).where(eq(budgetOverrides.budgetId, existing.id));
    await tx.delete(budgets).where(eq(budgets.id, existing.id));
  });
}

export async function saveBudget(database: Database, ws: WorkspaceContext, input: SaveBudgetInput): Promise<string> {
  const checked = checkedMonthly(input);
  await assertCategory(database, ws, input.categoryAccountId);
  const now = new Date().toISOString();
  return database.transaction(async (tx) => {
    const id = await writeBudget(tx, ws, input, checked, now);
    await assertParentsCapped(tx, ws, [input]);
    return id;
  });
}

/** Removes the budget and every override that only made sense against it; its %-children keep their plan in `month`. */
export async function removeBudget(database: Database, ws: WorkspaceContext, categoryAccountId: string, month: string): Promise<void> {
  assertMonth(month);
  const figures = await planFiguresOf(database, ws, month);
  await database.transaction((tx) => deleteBudget(tx, ws, categoryAccountId, figures));
}

export interface BudgetChanges {
  save: SaveBudgetInput[];
  remove: string[];
}

/**
 * Every budget the Edit budgets screen changed, written together: each row is checked before anything is written, so
 * one refusal leaves every budget as it was. A refusal names its category. A removed parent's %-children keep their
 * plan in `month`, the month the screen shows.
 */
export async function saveBudgets(database: Database, ws: WorkspaceContext, changes: BudgetChanges, month: string): Promise<void> {
  assertMonth(month);
  const checked: { input: SaveBudgetInput; monthly: Checked }[] = [];
  for (const input of changes.save) {
    try {
      const monthly = checkedMonthly(input);
      await assertCategory(database, ws, input.categoryAccountId);
      checked.push({ input, monthly });
    } catch (e) {
      if (e instanceof BudgetError) throw new BudgetError(e.code, e.message, input.categoryAccountId);
      throw e;
    }
  }
  if (checked.length === 0 && changes.remove.length === 0) return;
  const now = new Date().toISOString();
  const figures = changes.remove.length > 0 ? await planFiguresOf(database, ws, month) : new Map<string, number>();
  await database.transaction(async (tx) => {
    for (const categoryAccountId of changes.remove) await deleteBudget(tx, ws, categoryAccountId, figures);
    for (const { input, monthly } of checked) {
      try {
        await writeBudget(tx, ws, input, monthly, now);
      } catch (e) {
        if (e instanceof BudgetError && !e.categoryAccountId) throw new BudgetError(e.code, e.message, input.categoryAccountId);
        throw e;
      }
    }
    await assertParentsCapped(tx, ws, checked.map((entry) => entry.input));
  });
}

export async function setBudgetOverride(database: Database, ws: WorkspaceContext, input: SetOverrideInput): Promise<void> {
  assertMonth(input.month);
  assertWholeMinor(input.amountMinor);
  if (input.amountMinor < 0) throw new BudgetError('AMOUNT_RANGE', 'A month cannot ask for less than nothing');
  await assertInOpenBook(database, ws, input.categoryAccountId);

  await database.transaction(async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, input.categoryAccountId)));
    if (!budget) throw new BudgetError('NO_BUDGET', 'That category carries no budget to override');
    await withCapture(tx, { entity: 'budget_override' }, async () => {
      const [existing] = await tx
        .select({ id: budgetOverrides.id })
        .from(budgetOverrides)
        .where(and(eq(budgetOverrides.budgetId, budget.id), eq(budgetOverrides.month, input.month)));
      if (existing) {
        await tx.update(budgetOverrides).set({ amountMinor: input.amountMinor }).where(eq(budgetOverrides.id, existing.id));
        return;
      }
      await tx.insert(budgetOverrides).values({
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        budgetId: budget.id,
        month: input.month,
        amountMinor: input.amountMinor,
      });
    });
  });
}

export async function clearBudgetOverride(database: Database, ws: WorkspaceContext, categoryAccountId: string, month: string): Promise<void> {
  assertMonth(month);
  await database.transaction(async (tx) => {
    const [budget] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.workspaceId, ws.workspaceId), eq(budgets.categoryAccountId, categoryAccountId)));
    if (!budget) return;
    await withCapture(tx, { entity: 'budget_override' }, () =>
      tx.delete(budgetOverrides).where(and(eq(budgetOverrides.budgetId, budget.id), eq(budgetOverrides.month, month))),
    );
  });
}

/** The plan for one month, with that month's overrides already applied. */
export async function listBudgets(database: Database, ws: WorkspaceContext, month: string): Promise<BudgetRow[]> {
  assertMonth(month);
  const rows = await database.db
    .select({ id: budgets.id, categoryAccountId: budgets.categoryAccountId, amountMinor: budgets.amountMinor })
    .from(budgets)
    .where(
      and(
        eq(budgets.workspaceId, ws.workspaceId),
        // One book's caps when the context names one; every cap in the workspace otherwise.
        ...(ws.bookId ? [sql`${budgets.categoryAccountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    );

  const overrides = await database.db
    .select({ budgetId: budgetOverrides.budgetId, amountMinor: budgetOverrides.amountMinor })
    .from(budgetOverrides)
    .where(and(eq(budgetOverrides.workspaceId, ws.workspaceId), eq(budgetOverrides.month, month)));
  const overrideOf = new Map(overrides.map((row) => [row.budgetId, row.amountMinor]));
  const units = await unitsOf(database, ws);
  const unitOf = new Map(units.map((row) => [row.budgetId, row]));
  const planOf = await monthPlans(database, ws, month, rows, unitOf);
  const shares = (await budgetSharesExist(database.db))
    ? await database.db
        .select({ budgetId: budgetShares.budgetId, basis: budgetShares.basis, shareBp: budgetShares.shareBp })
        .from(budgetShares)
        .where(eq(budgetShares.workspaceId, ws.workspaceId))
    : [];
  const shareOf = new Map(shares.map((row) => [row.budgetId, { basis: row.basis, bp: row.shareBp } satisfies BudgetShare]));

  // Only a month with a share in it needs the take-home and the tree; every other month reads as it always has.
  let resolved: ReturnType<typeof resolveCaps> | null = null;
  if (rows.some((row) => shareOf.has(row.id))) {
    const [income, money, parents] = await Promise.all([
      getBudgetIncome(database, ws, month),
      bookMoneyFor(database, ws),
      database.db.select({ id: accounts.id, parentId: accounts.parentId }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId)),
    ]);
    const parentOf = new Map(parents.map((row) => [row.id, row.parentId]));
    resolved = resolveCaps(
      rows.map((row) => ({ categoryId: row.categoryAccountId, planMinor: planOf(row), overrideMinor: overrideOf.get(row.id) ?? null, share: shareOf.get(row.id) ?? null })),
      (id) => parentOf.get(id) ?? null,
      income.amountMinor,
      money.currency,
    );
  }

  return rows.map((row) => {
    const override = overrideOf.get(row.id);
    const figure = resolved?.get(row.categoryAccountId);
    const unit = unitOf.get(row.id);
    const plan = planOf(row);
    return {
      id: row.id,
      categoryAccountId: row.categoryAccountId,
      planMinor: figure?.planMinor ?? plan,
      amountMinor: figure?.amountMinor ?? override ?? plan,
      overridden: override !== undefined,
      frequency: unit?.frequency ?? 'monthly',
      amountAsSetMinor: unit?.amountAsSetMinor ?? row.amountMinor,
      everyWeeks: unit?.frequency === 'weekly' ? (unit.everyWeeks ?? 1) : null,
      startsOn: unit?.frequency === 'weekly' && (unit.everyWeeks ?? 1) > 1 ? unit.startsOn : null,
      share: shareOf.get(row.id) ?? null,
    };
  });
}

interface UnitRow {
  budgetId: string;
  frequency: Exclude<BudgetFrequency, 'monthly'>;
  amountAsSetMinor: number;
  everyWeeks: number | null;
  startsOn: string | null;
}

/** The workspace's budgets kept in another unit than a month (no row: monthly), with how a week repeats once 0129 ran. */
async function unitsOf(database: Database, ws: WorkspaceContext): Promise<UnitRow[]> {
  if (!(await healthTablesExist(database.db))) return [];
  if (await budgetRepeatColumnsExist(database.db)) {
    return database.db
      .select({
        budgetId: budgetFrequencies.budgetId,
        frequency: budgetFrequencies.frequency,
        amountAsSetMinor: budgetFrequencies.amountAsSetMinor,
        everyWeeks: budgetFrequencies.everyWeeks,
        startsOn: budgetFrequencies.startsOn,
      })
      .from(budgetFrequencies)
      .where(eq(budgetFrequencies.workspaceId, ws.workspaceId));
  }
  const rows = await database.db
    .select({ budgetId: budgetFrequencies.budgetId, frequency: budgetFrequencies.frequency, amountAsSetMinor: budgetFrequencies.amountAsSetMinor })
    .from(budgetFrequencies)
    .where(eq(budgetFrequencies.workspaceId, ws.workspaceId));
  return rows.map((row) => ({ ...row, everyWeeks: null, startsOn: null }));
}

/**
 * Each budget's plan for `month` (Budget C): a day or a week is the amount as typed × the times it comes up inside the
 * month's days — the workspace's month, by its "Month starts on" — counted by `budgetMonthMinor`; a week follows the
 * category's bill by the same weeks when it has one. Every other budget is budgets.amount_minor, exactly as before, and
 * a month with no day or week budget reads nothing more.
 */
async function monthPlans(
  database: Database,
  ws: WorkspaceContext,
  month: string,
  rows: readonly { id: string; categoryAccountId: string; amountMinor: number }[],
  unitOf: ReadonlyMap<string, UnitRow>,
): Promise<(row: { id: string; amountMinor: number; categoryAccountId: string }) => number> {
  const counted = rows.filter((row) => {
    const unit = unitOf.get(row.id);
    return unit !== undefined && isCountedRepeat(unit);
  });
  if (counted.length === 0) return (row) => row.amountMinor;
  const calendar = await budgetMonthOf(database, ws, month, counted.some((row) => unitOf.get(row.id)!.frequency === 'weekly'));
  const plans = new Map<string, number>();
  for (const row of counted) {
    const unit = unitOf.get(row.id)!;
    const repeat: BudgetRepeat = { frequency: unit.frequency, everyWeeks: unit.everyWeeks, startsOn: unit.startsOn };
    plans.set(row.id, budgetMonthMinor(unit.amountAsSetMinor, repeat, calendar.period, followedBill(calendar, row.categoryAccountId, repeat)?.dates ?? null));
  }
  return (row) => plans.get(row.id) ?? row.amountMinor;
}

/** A budget month's days, and each category's bills by weeks with their due dates inside them. */
export interface BudgetMonth {
  period: BudgetPeriod;
  bills: Readonly<Record<string, readonly WeeklyBillDates[]>>;
}

/**
 * The days `month` covers in this workspace (by its "Month starts on"), and the due dates in them of every bill by
 * weeks: what a budget by days or weeks is counted against, on the Budget page and in the forms that set one.
 */
export async function budgetMonthOf(database: Database, ws: WorkspaceContext, month: string, withBills = true): Promise<BudgetMonth> {
  assertMonth(month);
  const period = monthPeriod(month, await monthStartFor(database, ws));
  const bills = withBills ? await weeklyBillDatesIn(database, ws, period.from, period.to) : new Map<string, WeeklyBillDates[]>();
  return { period, bills: Object.fromEntries(bills) };
}

/**
 * The bill a budget by weeks follows: the category's first bill by the same weeks (a weekly bill for a week, every 3
 * weeks for every 3 weeks), whose due dates are then the budget's. None for a day, or a category without one.
 */
export function followedBill(month: BudgetMonth, categoryId: string, repeat: Pick<BudgetRepeat, 'frequency' | 'everyWeeks'>): WeeklyBillDates | undefined {
  if (repeat.frequency !== 'weekly') return undefined;
  const gap = repeat.everyWeeks ?? 1;
  return (month.bills[categoryId] ?? []).find((bill) => bill.everyWeeks === gap);
}
