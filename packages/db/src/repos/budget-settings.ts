import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { bookBudgetSettings, bookIncomeOverrides } from '../schema-books';
import { budgetIncomeOverrides, budgetSettings } from '../schema-budget';
import { BudgetError } from './budgets';
import { hasBooks, personalBookIdTx } from './books';

export interface BudgetIncome {
  /** What an ordinary month is expected to bring in. */
  planMinor: number;
  /** What this month expects: the override when there is one, otherwise the plan. */
  amountMinor: number;
  overridden: boolean;
}

export interface SetIncomeOverrideInput {
  month: string;
  amountMinor: number;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonth(month: string): void {
  if (!MONTH.test(month)) throw new BudgetError(`"${month}" is not a month; write it as YYYY-MM`);
}

function assertAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) throw new BudgetError('An amount must be a whole number of minor units');
  if (amountMinor < 0) throw new BudgetError('Income cannot be less than nothing');
}

/**
 * Which book a write naming no book falls back to (Personal), and whether the old, workspace-wide table should be
 * written too. The old table is Personal's — the app read nothing else before books existed — so it is written
 * whenever this write touches Personal: no book was named, or Personal's own id was. A write to another book (say
 * Business) leaves it alone, since it holds a different book's figure. On a database stopped before migration 0042
 * (no books table) there is no book to fall back to, and the old table is all there is.
 */
async function targetsFor(tx: Db, ws: WorkspaceContext): Promise<{ writeOld: boolean; bookId: string | null }> {
  const booksExist = await hasBooks(tx);
  const personalId = booksExist ? await personalBookIdTx(tx, ws.workspaceId) : null;
  return { writeOld: !ws.bookId || ws.bookId === personalId, bookId: ws.bookId ?? personalId };
}

/** What the owner expects to take home. Actual income is read from the ledger, never from here. */
export async function saveExpectedIncome(database: Database, ws: WorkspaceContext, amountMinor: number): Promise<void> {
  assertAmount(amountMinor);
  const now = new Date().toISOString();
  await database.transaction(async (tx) => {
    const { writeOld, bookId } = await targetsFor(tx, ws);

    if (writeOld) {
      const [existing] = await tx.select({ workspaceId: budgetSettings.workspaceId }).from(budgetSettings).where(eq(budgetSettings.workspaceId, ws.workspaceId));
      if (existing) {
        await tx.update(budgetSettings).set({ expectedIncomeMinor: amountMinor, updatedAt: now }).where(eq(budgetSettings.workspaceId, ws.workspaceId));
      } else {
        await tx.insert(budgetSettings).values({ workspaceId: ws.workspaceId, expectedIncomeMinor: amountMinor, updatedAt: now });
      }
    }
    if (bookId) {
      await tx
        .insert(bookBudgetSettings)
        .values({ bookId, workspaceId: ws.workspaceId, expectedIncomeMinor: amountMinor, updatedAt: now })
        .onConflictDoUpdate({ target: bookBudgetSettings.bookId, set: { expectedIncomeMinor: amountMinor, updatedAt: now } });
    }
  });
}

/** A bonus month expects something different, for that month alone. */
export async function setIncomeOverride(database: Database, ws: WorkspaceContext, input: SetIncomeOverrideInput): Promise<void> {
  assertMonth(input.month);
  assertAmount(input.amountMinor);
  await database.transaction(async (tx) => {
    const { writeOld, bookId } = await targetsFor(tx, ws);

    if (writeOld) {
      const [existing] = await tx
        .select({ month: budgetIncomeOverrides.month })
        .from(budgetIncomeOverrides)
        .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, input.month)));
      if (existing) {
        await tx
          .update(budgetIncomeOverrides)
          .set({ amountMinor: input.amountMinor })
          .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, input.month)));
      } else {
        await tx.insert(budgetIncomeOverrides).values({ workspaceId: ws.workspaceId, month: input.month, amountMinor: input.amountMinor });
      }
    }
    if (bookId) {
      await tx
        .insert(bookIncomeOverrides)
        .values({ bookId, workspaceId: ws.workspaceId, month: input.month, amountMinor: input.amountMinor })
        .onConflictDoUpdate({ target: [bookIncomeOverrides.bookId, bookIncomeOverrides.month], set: { amountMinor: input.amountMinor } });
    }
  });
}

export async function clearIncomeOverride(database: Database, ws: WorkspaceContext, month: string): Promise<void> {
  assertMonth(month);
  await database.transaction(async (tx) => {
    const { writeOld, bookId } = await targetsFor(tx, ws);

    if (writeOld) {
      await tx.delete(budgetIncomeOverrides).where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, month)));
    }
    if (bookId) {
      await tx.delete(bookIncomeOverrides).where(and(eq(bookIncomeOverrides.bookId, bookId), eq(bookIncomeOverrides.month, month)));
    }
  });
}

/** With a book named, reads that book's own figures; otherwise the old, workspace-wide ones — never a mix of both. */
export async function getBudgetIncome(database: Database, ws: WorkspaceContext, month: string): Promise<BudgetIncome> {
  assertMonth(month);
  if (ws.bookId) {
    const [settings] = await database.db
      .select({ expectedIncomeMinor: bookBudgetSettings.expectedIncomeMinor })
      .from(bookBudgetSettings)
      .where(eq(bookBudgetSettings.bookId, ws.bookId));
    const [override] = await database.db
      .select({ amountMinor: bookIncomeOverrides.amountMinor })
      .from(bookIncomeOverrides)
      .where(and(eq(bookIncomeOverrides.bookId, ws.bookId), eq(bookIncomeOverrides.month, month)));
    const planMinor = settings?.expectedIncomeMinor ?? 0;
    return { planMinor, amountMinor: override?.amountMinor ?? planMinor, overridden: override !== undefined };
  }

  const [settings] = await database.db
    .select({ expectedIncomeMinor: budgetSettings.expectedIncomeMinor })
    .from(budgetSettings)
    .where(eq(budgetSettings.workspaceId, ws.workspaceId));
  const [override] = await database.db
    .select({ amountMinor: budgetIncomeOverrides.amountMinor })
    .from(budgetIncomeOverrides)
    .where(and(eq(budgetIncomeOverrides.workspaceId, ws.workspaceId), eq(budgetIncomeOverrides.month, month)));

  const planMinor = settings?.expectedIncomeMinor ?? 0;
  return { planMinor, amountMinor: override?.amountMinor ?? planMinor, overridden: override !== undefined };
}
