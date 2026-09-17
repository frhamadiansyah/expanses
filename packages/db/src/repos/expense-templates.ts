import { uuidv7 } from '@expanses/core';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { billSkips, expenseTemplates } from '../schema-recurring';

export class RecurringError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecurringError';
  }
}

export interface ExpenseTemplateRow {
  id: string;
  name: string;
  categoryAccountId: string;
  moneyAccountId: string;
  /** Null when the amount differs every month; you type it when you record the bill. */
  amountMinor: number | null;
  dayOfMonth: number;
  active: boolean;
}

export interface SaveExpenseTemplateInput {
  id?: string;
  name: string;
  categoryAccountId: string;
  moneyAccountId: string;
  amountMinor?: number | null;
  dayOfMonth: number;
  active?: boolean;
}

const toRow = (row: typeof expenseTemplates.$inferSelect): ExpenseTemplateRow => ({
  id: row.id,
  name: row.name,
  categoryAccountId: row.categoryAccountId,
  moneyAccountId: row.moneyAccountId,
  amountMinor: row.amountMinor,
  dayOfMonth: row.dayOfMonth,
  active: row.active === 1,
});

async function accountKind(database: Database, ws: WorkspaceContext, accountId: string): Promise<string | undefined> {
  const [row] = await database.db
    .select({ kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return row?.kind;
}

/** Adds or edits a recurring bill. */
export async function saveExpenseTemplate(database: Database, ws: WorkspaceContext, input: SaveExpenseTemplateInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new RecurringError('NAME_REQUIRED', 'A bill needs a name');
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
    throw new RecurringError('DAY_RANGE', 'The day of the month must be between 1 and 31');
  }
  const amountMinor = input.amountMinor ?? null;
  if (amountMinor !== null && !(amountMinor > 0)) {
    throw new RecurringError('AMOUNT_RANGE', 'Leave the amount empty if it differs every month, or give one above nought');
  }

  // A bill points at a spending category and at the money that pays it. Crossing the two would post
  // a payment nobody could read, so it is refused rather than corrected.
  if ((await accountKind(database, ws, input.categoryAccountId)) !== 'expense') {
    throw new RecurringError('NOT_A_CATEGORY', 'A bill needs a spending category');
  }
  const payer = await accountKind(database, ws, input.moneyAccountId);
  if (payer !== 'asset' && payer !== 'liability') {
    throw new RecurringError('NOT_A_WALLET', 'A bill needs an account or a card to pay it');
  }

  const id = input.id ?? uuidv7();
  await database.db
    .insert(expenseTemplates)
    .values({
      id,
      workspaceId: ws.workspaceId,
      name,
      categoryAccountId: input.categoryAccountId,
      moneyAccountId: input.moneyAccountId,
      amountMinor,
      dayOfMonth: input.dayOfMonth,
      active: input.active === false ? 0 : 1,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: expenseTemplates.id,
      set: {
        name,
        categoryAccountId: input.categoryAccountId,
        moneyAccountId: input.moneyAccountId,
        amountMinor,
        dayOfMonth: input.dayOfMonth,
        active: input.active === false ? 0 : 1,
      },
    });
  return id;
}

export async function listExpenseTemplates(database: Database, ws: WorkspaceContext): Promise<ExpenseTemplateRow[]> {
  const rows = await database.db
    .select()
    .from(expenseTemplates)
    .where(
      and(
        eq(expenseTemplates.workspaceId, ws.workspaceId),
        sql`${expenseTemplates.archivedAt} IS NULL`,
        // One book's bills when the context names one; every bill in the workspace otherwise. dueExpenseTemplates,
        // committedByCategory and monthlyBills all build on this list, so narrowing here narrows them too.
        ...(ws.bookId ? [sql`${expenseTemplates.categoryAccountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    )
    .orderBy(asc(expenseTemplates.dayOfMonth), asc(expenseTemplates.createdAt));
  return rows.map(toRow);
}

export async function deleteExpenseTemplate(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(expenseTemplates)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(expenseTemplates.workspaceId, ws.workspaceId), eq(expenseTemplates.id, id)));
}

/**
 * Bills whose day has passed this month with nothing recorded against them yet.
 *
 * There is no background job, and none is wanted: the Transactions page asks when it opens. A bill
 * paid early still counts, because the question is whether this month's is settled, not when.
 */
export async function dueExpenseTemplates(database: Database, ws: WorkspaceContext, onDate: string): Promise<ExpenseTemplateRow[]> {
  const month = onDate.slice(0, 7);
  const day = Number(onDate.slice(8, 10));
  const templates = (await listExpenseTemplates(database, ws)).filter((template) => template.active && template.dayOfMonth <= day);
  if (templates.length === 0) return [];

  const recorded = await database.db
    .select({ templateId: transactions.templateId })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        gte(transactions.occurredOn, `${month}-01`),
        lte(transactions.occurredOn, `${month}-31`),
      ),
    );
  const done = new Set(recorded.map((row) => row.templateId).filter((id): id is string => id !== null));
  return templates.filter((template) => !done.has(template.id));
}

/**
 * What each category already owes to bills this month, so a budget can say how much of it is spoken
 * for. A bill with no fixed amount contributes nothing: guessing one would overstate the commitment.
 */
export async function committedByCategory(database: Database, ws: WorkspaceContext): Promise<Record<string, number>> {
  const templates = await listExpenseTemplates(database, ws);
  const committed: Record<string, number> = {};
  for (const template of templates) {
    if (!template.active || template.amountMinor === null) continue;
    committed[template.categoryAccountId] = (committed[template.categoryAccountId] ?? 0) + template.amountMinor;
  }
  return committed;
}

/** Where a recurring bill stands this month. */
export type BillState = 'paid' | 'owed' | 'later' | 'skipped';

export interface MonthlyBill extends ExpenseTemplateRow {
  state: BillState;
  /** The date the bill was recorded on, when it has been. Not the day it was due. */
  paidOn: string | null;
  /** What it came to when it was paid, which may differ from the template's amount. */
  paidMinor: number | null;
}

/**
 * Every active recurring bill, and where it stands in the month `onDate` falls in.
 *
 * One question answered in one place: what is paid, what is owed now, what is still to come, and what was
 * deliberately skipped. A bill paid early counts as paid, because the question is whether this month's is
 * settled rather than when it was.
 */
export async function monthlyBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  const month = onDate.slice(0, 7);
  const today = Number(onDate.slice(8, 10));
  const templates = (await listExpenseTemplates(database, ws)).filter((template) => template.active);
  if (templates.length === 0) return [];

  const recorded = await database.db
    .select({ templateId: transactions.templateId, occurredOn: transactions.occurredOn, id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        gte(transactions.occurredOn, `${month}-01`),
        lte(transactions.occurredOn, `${month}-31`),
      ),
    );
  const paid = new Map<string, { occurredOn: string; id: string }>();
  for (const row of recorded) if (row.templateId) paid.set(row.templateId, { occurredOn: row.occurredOn, id: row.id });

  const skips = await database.db
    .select({ templateId: billSkips.templateId })
    .from(billSkips)
    .where(and(eq(billSkips.workspaceId, ws.workspaceId), eq(billSkips.month, month)));
  const skipped = new Set(skips.map((row) => row.templateId));

  const amounts = paid.size === 0 ? [] : await database.db
    .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor })
    .from(entries)
    .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, [...paid.values()].map((row) => row.id))));

  return templates
    .map((template): MonthlyBill => {
      const settled = paid.get(template.id);
      const line = settled ? amounts.find((row) => row.transactionId === settled.id && row.accountId === template.categoryAccountId) : undefined;
      const state: BillState = settled ? 'paid' : skipped.has(template.id) ? 'skipped' : template.dayOfMonth <= today ? 'owed' : 'later';
      return { ...template, state, paidOn: settled?.occurredOn ?? null, paidMinor: line ? Number(line.amountMinor) : null };
    })
    .sort((a, b) => a.dayOfMonth - b.dayOfMonth || a.name.localeCompare(b.name));
}

/** Marks this month's bill as deliberately unpaid, so it stops being owed. Skipping twice changes nothing. */
export async function skipBill(database: Database, ws: WorkspaceContext, templateId: string, month: string): Promise<void> {
  await database.db
    .insert(billSkips)
    .values({ workspaceId: ws.workspaceId, templateId, month, createdAt: new Date().toISOString() })
    .onConflictDoNothing();
}

/** Takes back a skip, so the bill is owed again. */
export async function unskipBill(database: Database, ws: WorkspaceContext, templateId: string, month: string): Promise<void> {
  await database.db
    .delete(billSkips)
    .where(and(eq(billSkips.workspaceId, ws.workspaceId), eq(billSkips.templateId, templateId), eq(billSkips.month, month)));
}
