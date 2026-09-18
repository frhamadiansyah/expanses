import {
  addMonths,
  billStanding,
  type BillStateKind,
  billWindow,
  type BillWindow,
  currentBillMonth,
  expenseLines,
  isoDate,
  monthOf,
  payableBillMonths,
  uuidv7,
} from '@expanses/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { bookCategories, books } from '../schema-books';
import { billPayments, billSkips, billWindows, expenseTemplates } from '../schema-recurring';
import { BILL_MONTH, billTablesExist } from './bill-months';
import { bookMoneyFor, type Unconverted } from './book-currency';
import { bookOfCategory, hasBooks } from './books';
import { postTransactionTx, voidTransactionTx } from './ledger';

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
  /** The day it must be paid by; earlier than dayOfMonth means the next month. Null: due the day it comes out. */
  payByDay: number | null;
  /** YYYY-MM: the first month this bill can be owed for. */
  startsMonth: string;
}

export interface SaveExpenseTemplateInput {
  id?: string;
  name: string;
  categoryAccountId: string;
  moneyAccountId: string;
  amountMinor?: number | null;
  dayOfMonth: number;
  active?: boolean;
  payByDay?: number | null;
  /** A new bill's first month; this month when absent. Ignored on an edit. */
  startsMonth?: string;
}

const toRow = (row: typeof expenseTemplates.$inferSelect, window?: { payByDay: number | null; startsMonth: string }): ExpenseTemplateRow => ({
  id: row.id,
  name: row.name,
  categoryAccountId: row.categoryAccountId,
  moneyAccountId: row.moneyAccountId,
  amountMinor: row.amountMinor,
  dayOfMonth: row.dayOfMonth,
  active: row.active === 1,
  payByDay: window?.payByDay ?? null,
  // An older database has no windows: the month the bill was made is the nearest honest answer.
  startsMonth: window?.startsMonth ?? row.createdAt.slice(0, 7),
});

async function accountKind(db: Db, ws: WorkspaceContext, accountId: string): Promise<string | undefined> {
  const [row] = await db
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
  const payByDay = input.payByDay ?? null;
  if (payByDay !== null && (!Number.isInteger(payByDay) || payByDay < 1 || payByDay > 31)) {
    throw new RecurringError('PAY_BY_RANGE', 'The pay-by day must be between 1 and 31, or left empty');
  }
  if (input.startsMonth !== undefined && !BILL_MONTH.test(input.startsMonth)) {
    throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  }

  // One write: a bill saved without its window would have no pay-by day and a first month guessed from createdAt.
  return database.transaction(async (tx) => {
    // A bill points at a spending category and at the money that pays it. Crossing the two would post
    // a payment nobody could read, so it is refused rather than corrected.
    if ((await accountKind(tx, ws, input.categoryAccountId)) !== 'expense') {
      throw new RecurringError('NOT_A_CATEGORY', 'A bill needs a spending category');
    }
    // A bill is listed by the workspace that owns its category, so a category filed elsewhere would save a bill
    // this workspace could never see again — and would post its payment into the other workspace.
    if (ws.bookId && (await hasBooks(tx))) {
      const owner = await bookOfCategory(tx, input.categoryAccountId);
      if (owner && owner !== ws.bookId) throw new RecurringError('OTHER_BOOK', 'That category belongs to another workspace');
    }
    const payer = await accountKind(tx, ws, input.moneyAccountId);
    if (payer !== 'asset' && payer !== 'liability') {
      throw new RecurringError('NOT_A_WALLET', 'A bill needs an account or a card to pay it');
    }

    const id = input.id ?? uuidv7();
    await tx
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

    if (await billTablesExist(tx)) {
      await tx
        .insert(billWindows)
        .values({ templateId: id, workspaceId: ws.workspaceId, payByDay, startsMonth: input.startsMonth ?? isoDate().slice(0, 7) })
        .onConflictDoUpdate({ target: billWindows.templateId, set: { payByDay } });
    }
    return id;
  });
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
  const windows = (await billTablesExist(database.db))
    ? await database.db.select().from(billWindows).where(eq(billWindows.workspaceId, ws.workspaceId))
    : [];
  const byTemplate = new Map(windows.map((w) => [w.templateId, w]));
  return rows.map((row) => toRow(row, byTemplate.get(row.id)));
}

export async function deleteExpenseTemplate(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(expenseTemplates)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(expenseTemplates.workspaceId, ws.workspaceId), eq(expenseTemplates.id, id)));
}

/**
 * What each category already owes to bills this month, so a budget can say how much of it is spoken
 * for. A bill with no fixed amount contributes nothing: guessing one would overstate the commitment.
 *
 * A bill's amount is in the currency of the account that pays it, so the sum is brought into the currency the
 * workspace reads in, at today's rate — which is also what stops a dollar bill and a rupiah bill being added
 * together as though they were the same money. A bill no rate reaches is named in `missing` rather than only
 * dropped: an understated commitment is worse than a stated gap.
 */
export async function committedByCategory(
  database: Database,
  ws: WorkspaceContext,
): Promise<{ committed: Record<string, number>; currency: string; missing: Unconverted[] }> {
  const templates = await listExpenseTemplates(database, ws);
  const money = await bookMoneyFor(database, ws);
  const payers = new Map(
    (await database.db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId))).map((row) => [
      row.id,
      row.currency,
    ]),
  );
  const today = isoDate();
  const committed: Record<string, number> = {};
  for (const template of templates) {
    if (!template.active || template.amountMinor === null) continue;
    // No rate reaching today leaves the bill out rather than counting it as the wrong money — and says so in
    // `missing`, so the budget's "… of it is bills" line cannot quietly understate what is already spoken for.
    const amountMinor = money.convert(template.amountMinor, payers.get(template.moneyAccountId) ?? ws.baseCurrency, today);
    if (amountMinor === null) continue;
    committed[template.categoryAccountId] = (committed[template.categoryAccountId] ?? 0) + amountMinor;
  }
  return { committed, currency: money.currency, missing: money.missing() };
}

/** Where one month's bill stands. */
export type BillState = BillStateKind;

export interface MonthlyBill extends ExpenseTemplateRow {
  /** YYYY-MM: the month this row speaks for — last month while that is unsettled, otherwise this month. */
  billMonth: string;
  window: BillWindow;
  state: BillStateKind;
  days: number;
  /** The day the payment for billMonth was made. Not the day it was due. */
  paidOn: string | null;
  /** What it came to, which may differ from the template's amount. */
  paidMinor: number | null;
  paymentId: string | null;
  /** The fixed amount, else what it came to the last time it was paid, else null. */
  estimateMinor: number | null;
  /** Months a payment can be recorded for, oldest unsettled first. */
  payableMonths: string[];
}

export interface BillHistoryRow {
  month: string;
  window: BillWindow;
  state: BillStateKind;
  days: number;
  paidOn: string | null;
  paidMinor: number | null;
  paymentId: string | null;
}

export interface BillDetail {
  bill: MonthlyBill;
  history: BillHistoryRow[];
  /** The workspace the bill's category is filed in; null on a database without books. */
  bookName: string | null;
}

interface PaymentFact {
  templateId: string;
  billMonth: string;
  transactionId: string;
  occurredOn: string;
  amountMinor: number | null;
}

interface BillFacts {
  /** Per bill, newest payment first. */
  payments: Map<string, PaymentFact[]>;
  skips: Map<string, Set<string>>;
}

/** Posted payments and skips for these bills. Without migration 0044 a payment settles the month it was made in. */
async function billFacts(database: Database, ws: WorkspaceContext, templates: ExpenseTemplateRow[]): Promise<BillFacts> {
  const ids = templates.map((t) => t.id);
  const payments = new Map<string, PaymentFact[]>();
  const skips = new Map<string, Set<string>>();
  if (ids.length === 0) return { payments, skips };

  const rows = (await billTablesExist(database.db))
    ? await database.db
        .select({ templateId: billPayments.templateId, billMonth: billPayments.billMonth, transactionId: transactions.id, occurredOn: transactions.occurredOn })
        .from(billPayments)
        .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
        .where(and(eq(billPayments.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(billPayments.templateId, ids)))
    : (
        await database.db
          .select({ templateId: transactions.templateId, transactionId: transactions.id, occurredOn: transactions.occurredOn })
          .from(transactions)
          .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(transactions.templateId, ids)))
      ).map((row) => ({ ...row, templateId: row.templateId!, billMonth: row.occurredOn.slice(0, 7) }));

  const lines = rows.length === 0
    ? []
    : await database.db
        .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor })
        .from(entries)
        .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, rows.map((row) => row.transactionId))));
  const categoryOf = new Map(templates.map((t) => [t.id, t.categoryAccountId]));
  for (const row of rows) {
    const line = lines.find((l) => l.transactionId === row.transactionId && l.accountId === categoryOf.get(row.templateId));
    const list = payments.get(row.templateId) ?? [];
    list.push({ ...row, amountMinor: line ? Number(line.amountMinor) : null });
    payments.set(row.templateId, list);
  }
  for (const list of payments.values()) list.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  const skipRows = await database.db
    .select({ templateId: billSkips.templateId, month: billSkips.month })
    .from(billSkips)
    .where(and(eq(billSkips.workspaceId, ws.workspaceId), inArray(billSkips.templateId, ids)));
  for (const row of skipRows) {
    const set = skips.get(row.templateId) ?? new Set<string>();
    set.add(row.month);
    skips.set(row.templateId, set);
  }
  return { payments, skips };
}

function settledOf(template: ExpenseTemplateRow, facts: BillFacts): Record<string, 'paid' | 'skipped'> {
  const settled: Record<string, 'paid' | 'skipped'> = {};
  for (const month of facts.skips.get(template.id) ?? []) settled[month] = 'skipped';
  // A month both skipped and paid was paid.
  for (const payment of facts.payments.get(template.id) ?? []) settled[payment.billMonth] = 'paid';
  return settled;
}

function monthOfBill(template: ExpenseTemplateRow, facts: BillFacts, month: string, today: string): BillHistoryRow {
  const settled = settledOf(template, facts);
  const window = billWindow(month, template.dayOfMonth, template.payByDay);
  const payment = (facts.payments.get(template.id) ?? []).find((p) => p.billMonth === month) ?? null;
  const standing = billStanding(window, today, settled[month] ?? null);
  return { month, window, ...standing, paidOn: payment?.occurredOn ?? null, paidMinor: payment?.amountMinor ?? null, paymentId: payment?.transactionId ?? null };
}

function billRow(template: ExpenseTemplateRow, facts: BillFacts, today: string): MonthlyBill {
  const settled = settledOf(template, facts);
  const input = { today, startsMonth: template.startsMonth, outDay: template.dayOfMonth, payByDay: template.payByDay, settled };
  const { month, ...rest } = monthOfBill(template, facts, currentBillMonth(input), today);
  return {
    ...template,
    billMonth: month,
    ...rest,
    estimateMinor: template.amountMinor ?? facts.payments.get(template.id)?.[0]?.amountMinor ?? null,
    payableMonths: payableBillMonths(input),
  };
}

/**
 * Every active recurring bill, and where the month it speaks for stands on `onDate`.
 *
 * A bill belongs to the month it comes out, and a payment settles the month it names — so internet paid on
 * 3 September for August settles August, and September's bill is still to come.
 */
export async function monthlyBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  const templates = (await listExpenseTemplates(database, ws)).filter((template) => template.active);
  const facts = await billFacts(database, ws, templates);
  return templates
    .map((template) => billRow(template, facts, onDate))
    .sort((a, b) => a.window.payBy.localeCompare(b.window.payBy) || a.name.localeCompare(b.name));
}

/** One bill with its months, newest first: every month paid or skipped, and every month since it was tracked. */
export async function billDetail(database: Database, ws: WorkspaceContext, templateId: string, onDate: string): Promise<BillDetail> {
  const template = (await listExpenseTemplates(database, ws)).find((t) => t.id === templateId);
  if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
  const facts = await billFacts(database, ws, [template]);
  const months = new Set<string>([...(facts.skips.get(template.id) ?? []), ...(facts.payments.get(template.id) ?? []).map((p) => p.billMonth)]);
  for (let month = template.startsMonth; month <= monthOf(onDate); month = addMonths(month, 1)) months.add(month);
  const history = [...months]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 12)
    .map((month) => monthOfBill(template, facts, month, onDate));

  let bookName: string | null = null;
  if (await hasBooks(database.db)) {
    const [row] = await database.db
      .select({ name: books.name })
      .from(bookCategories)
      .innerJoin(books, eq(books.id, bookCategories.bookId))
      .where(and(eq(bookCategories.workspaceId, ws.workspaceId), eq(bookCategories.categoryAccountId, template.categoryAccountId)));
    bookName = row?.name ?? null;
  }
  return { bill: billRow(template, facts, onDate), history, bookName };
}

/** Bills that are out and unpaid on `onDate`: overdue, due soon, or open. */
export async function dueExpenseTemplates(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  return (await monthlyBills(database, ws, onDate)).filter((bill) => bill.state === 'overdue' || bill.state === 'dueSoon' || bill.state === 'open');
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

export interface BillPaymentInput {
  templateId: string;
  /** YYYY-MM: which month's bill this pays. */
  billMonth: string;
  amountMinor: number;
  /** The account that paid; the bill's own when absent. */
  moneyAccountId?: string;
}

async function isSettled(tx: Db, ws: WorkspaceContext, templateId: string, month: string): Promise<boolean> {
  const [skipped] = await tx
    .select({ month: billSkips.month })
    .from(billSkips)
    .where(and(eq(billSkips.workspaceId, ws.workspaceId), eq(billSkips.templateId, templateId), eq(billSkips.month, month)));
  if (skipped) return true;
  const [paid] = (await billTablesExist(tx))
    ? await tx
        .select({ id: transactions.id })
        .from(billPayments)
        .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
        .where(and(eq(billPayments.workspaceId, ws.workspaceId), eq(billPayments.templateId, templateId), eq(billPayments.billMonth, month), eq(transactions.status, 'posted')))
    : await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.templateId, templateId), eq(transactions.status, 'posted'), sql`substr(${transactions.occurredOn}, 1, 7) = ${month}`));
  return Boolean(paid);
}

/**
 * Records bill payments on one day, each an ordinary expense against its bill's category, linked to the bill and to
 * the month it settles. All or nothing: a batch caught up on a Sunday either lands whole or not at all.
 */
export function recordBillPayments(
  database: Database,
  ws: WorkspaceContext,
  input: { paidOn: string; payments: BillPaymentInput[]; ratesToBase?: Record<string, number> },
): Promise<string[]> {
  return database.transaction(async (tx) => {
    const ids: string[] = [];
    for (const payment of input.payments) {
      if (!BILL_MONTH.test(payment.billMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
      if (!(Number.isSafeInteger(payment.amountMinor) && payment.amountMinor > 0)) {
        throw new RecurringError('AMOUNT_RANGE', 'Enter what the bill came to');
      }
      const [template] = await tx
        .select()
        .from(expenseTemplates)
        .where(and(eq(expenseTemplates.workspaceId, ws.workspaceId), eq(expenseTemplates.id, payment.templateId), sql`${expenseTemplates.archivedAt} IS NULL`));
      if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
      const [wallet] = await tx
        .select({ kind: accounts.kind, currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.id, payment.moneyAccountId ?? template.moneyAccountId)));
      if (!wallet || (wallet.kind !== 'asset' && wallet.kind !== 'liability')) {
        throw new RecurringError('NOT_A_WALLET', 'A bill is paid from an account or a card');
      }
      if (await isSettled(tx, ws, template.id, payment.billMonth)) {
        throw new RecurringError('ALREADY_SETTLED', `${template.name} is already settled for that month`);
      }
      const currency = wallet.currency ?? ws.baseCurrency;
      ids.push(
        await postTransactionTx(tx, ws, {
          occurredOn: input.paidOn,
          description: template.name,
          templateId: template.id,
          billMonth: payment.billMonth,
          ratesToBase: input.ratesToBase,
          lines: expenseLines({ categoryAccountId: template.categoryAccountId, paymentAccountId: payment.moneyAccountId ?? template.moneyAccountId, amountMinor: payment.amountMinor, currency }),
        }),
      );
    }
    return ids;
  });
}

/** Takes recorded payments back: they are voided, so the months they settled are owed again. */
export function undoBillPayments(database: Database, ws: WorkspaceContext, transactionIds: readonly string[]): Promise<void> {
  return database.transaction(async (tx) => {
    for (const id of transactionIds) await voidTransactionTx(tx, ws, id);
  });
}
