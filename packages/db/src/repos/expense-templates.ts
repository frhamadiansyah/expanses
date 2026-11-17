import {
  addMonths,
  isSupportedCurrency,
  billStanding,
  type BillStateKind,
  billWindow,
  type BillWindow,
  currentBillMonth,
  latestLinkMonth as latestLinkMonthOf,
  linkChoice,
  nextOccurrenceMonth,
  isOwedMonth,
  expenseLines,
  sinkingPlan,
  sinkingProgress,
  type SinkingSaveResult,
  sinkingSavePlan,
  transferLines,
  isoDate,
  monthOf,
  payableBillMonths,
  pausedMonths,
  pausedUntil,
  pauseStart,
  thisBillMonth,
  billMonthIn,
  type MonthStartDay,
  uuidv7,
  yearlyListed,
} from '@expanses/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { bookCategories, books } from '../schema-books';
import { billPauses, billPayments, billSkips, billWindows, expenseTemplates } from '../schema-recurring';
import { billCurrencies, writeBillCurrency } from './bill-currency';
import { type BillRepeatFacts, billRepeats, writeBillRepeat } from './bill-repeat';
import { fundRoom, fundShortMessage } from './sinking-actions';
import { dropSinkingFund, getSinkingFund, moveSinkingFund, type SinkingFundRow, setSinkingCustom, writeSinkingFund, writeSinkingOpening, writeSinkingPlan } from './sinking-funds';
import { sinkingFactsOf } from './sinking-views';
import { BILL_MONTH, billPausesExist, billTablesExist } from './bill-months';
import { monthStartFor } from './month-start';
import { captureBillLinkingTx, withCapture } from '../sync/capture';
import { bookMoneyFor, type Unconverted } from './book-currency';
import { bookOfCategory, hasBooks } from './books';
import { postTransactionTx, voidTransactionTx } from './ledger';
import type { SetAsideChoice } from './set-aside-tx';
import { recordActivityTx } from './activity-log';

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
  /**
   * The currency the bill is written in (0098). Null while it follows the account that pays it, which is every bill
   * made before: its amount is then in that account's currency.
   */
  currency: string | null;
  /**
   * 'yearly' for a bill owed once a year, in `repeatMonth` (0099); 'months' for one owed every `repeatEvery` months from
   * the month `repeatMonth` (0102); 'monthly' for every other bill.
   */
  repeat: 'monthly' | 'yearly' | 'months';
  /** 1-12: the month of the year a yearly bill comes out, or an every-few-months bill's first month; null when monthly. */
  repeatMonth: number | null;
  /** 2-11: months between occurrences of an every-few-months bill; null otherwise. */
  repeatEvery: number | null;
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
  /** The bill's own currency; null follows the payer. Absent leaves an edited bill's as it was (a new bill follows). */
  currency?: string | null;
  /** How often it comes out. Absent leaves an edited bill's as it was (a new bill is monthly). */
  repeat?: 'monthly' | 'yearly' | 'months';
  /** 1-12: required for a yearly or every-few-months bill (for the latter, the month of its first occurrence). */
  repeatMonth?: number | null;
  /** 2-11: required for an every-few-months bill. */
  repeatEvery?: number | null;
  /**
   * A yearly bill's sinking fund (0101): the account it is set aside in and the monthly figure (worked out from the
   * amount and the months left when absent). Null turns the fund off; absent leaves an edited bill's as it was.
   */
  fund?: {
    accountId: string;
    monthlyMinor?: number | null;
    /** 'Already saved': money put by before the fund was set up. Absent leaves it as it was; 0 or null clears it. */
    alreadySavedMinor?: number | null;
  } | null;
}

const toRow = (
  row: typeof expenseTemplates.$inferSelect,
  window?: { payByDay: number | null; startsMonth: string },
  currency: string | null = null,
  repeatFacts: BillRepeatFacts | null = null,
): ExpenseTemplateRow => ({
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
  currency,
  repeat: repeatFacts?.repeat ?? 'monthly',
  repeatMonth: repeatFacts?.month ?? null,
  repeatEvery: repeatFacts?.every ?? null,
});

async function accountCurrency(db: Db, ws: WorkspaceContext, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return row?.currency ?? null;
}

async function accountKind(db: Db, ws: WorkspaceContext, accountId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ kind: accounts.kind })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  return row?.kind;
}

/** The month a bill's window starts, as stored; `fallback` for a bill without one. */
async function storedStartsMonth(db: Db, id: string, fallback: string): Promise<string> {
  if (!(await billTablesExist(db))) return fallback;
  const [window] = await db.select({ startsMonth: billWindows.startsMonth }).from(billWindows).where(eq(billWindows.templateId, id));
  return window?.startsMonth ?? fallback;
}

interface FundPlan {
  accountId: string;
  existing: SinkingFundRow | null;
  result: SinkingSaveResult;
}

/**
 * Works out what saving the form does to a yearly bill's sinking fund, and refuses it when the account cannot hold
 * what the fund promises right now (already saved plus this month's amount): the account's free money (balance minus
 * every other promise, this bill's own claim left out) must cover it. Only NOW is checked, never the months to come:
 * later months are a plan, and a plan that outgrows the account shows as a shortage on the set-aside view.
 */
async function planFund(
  database: Database,
  ws: WorkspaceContext,
  input: SaveExpenseTemplateInput,
  ctx: { id: string; yearlyMonth: number; repeatNow: BillRepeatFacts | null; amountMinor: number | null; today: string; startsMonth: string; oldAmountMinor: number | null },
): Promise<FundPlan> {
  const fund = input.fund!;
  const { amountMinor, today } = ctx;
  if (amountMinor === null) throw new RecurringError('FUND_AMOUNT', 'A sinking fund needs a fixed amount');
  const db = database.db;
  const [fundAccount] = await db
    .select({ kind: accounts.kind, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, fund.accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!fundAccount || fundAccount.kind !== 'asset') throw new RecurringError('FUND_ACCOUNT', 'Choose an account to set the money aside in');
  const fundCurrency = fundAccount.currency ?? ws.baseCurrency;
  const own = input.currency !== undefined ? input.currency : ((await billCurrencies(db, ws)).get(ctx.id) ?? null);
  const billCurrency = own ?? (await accountCurrency(db, ws, input.moneyAccountId)) ?? ws.baseCurrency;
  if (fundCurrency !== billCurrency) throw new RecurringError('FUND_CURRENCY', `Set the money aside in an account in ${billCurrency}`);
  if (fund.monthlyMinor != null && !(Number.isSafeInteger(fund.monthlyMinor) && fund.monthlyMinor > 0)) {
    throw new RecurringError('FUND_MONTHLY', 'Enter the amount to set aside each month');
  }
  if (fund.alreadySavedMinor != null && !(Number.isSafeInteger(fund.alreadySavedMinor) && fund.alreadySavedMinor >= 0)) {
    throw new RecurringError('FUND_OPENING', 'Enter the amount already saved');
  }
  const dueMonth = sinkingPlan({
    targetMinor: amountMinor,
    today,
    repeatMonth: ctx.yearlyMonth,
    dayOfMonth: input.dayOfMonth,
    currency: billCurrency,
    repeatEvery: ctx.repeatNow?.every,
    startsMonth: ctx.startsMonth,
  }).dueMonth;
  const existing = await getSinkingFund(db, ws, ctx.id);
  const result = sinkingSavePlan({
    existing: existing ? sinkingFactsOf(existing) : null,
    existingCustom: existing?.custom ?? false,
    targetMinor: amountMinor,
    oldTargetMinor: ctx.oldAmountMinor,
    today,
    dueMonth,
    currency: billCurrency,
    typedMonthlyMinor: fund.monthlyMinor ?? null,
    openingMinor: fund.alreadySavedMinor,
  });
  const monthly = result.plan?.monthlyMinor ?? result.facts.monthlyMinor;
  if (!(Number.isSafeInteger(monthly) && monthly > 0)) throw new RecurringError('FUND_MONTHLY', 'Enter the amount to set aside each month');

  const promisedNow = sinkingProgress(result.facts, amountMinor, dueMonth, today).savedMinor;
  const heldNow = existing && existing.accountId === fund.accountId ? sinkingProgress(sinkingFactsOf(existing), amountMinor, dueMonth, today).savedMinor : 0;
  // Nothing new is promised, so an account already short for other reasons does not block an unrelated edit.
  if (promisedNow > heldNow) {
    const room = await fundRoom(database, ws, fund.accountId, today, ctx.id);
    if (room && promisedNow > room.freeMinor) throw new RecurringError('FUND_SHORT', fundShortMessage(room, promisedNow));
  }
  return { accountId: fund.accountId, existing, result };
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
  if (input.currency != null && !isSupportedCurrency(input.currency)) {
    throw new RecurringError('CURRENCY', `Unsupported currency "${input.currency}"`);
  }
  if (input.repeat === 'yearly' && !(Number.isInteger(input.repeatMonth) && input.repeatMonth! >= 1 && input.repeatMonth! <= 12)) {
    throw new RecurringError('MONTH_REQUIRED', 'Choose the month');
  }
  if (input.repeat === 'months') {
    if (!(Number.isInteger(input.repeatMonth) && input.repeatMonth! >= 1 && input.repeatMonth! <= 12)) throw new RecurringError('MONTH_REQUIRED', 'Choose the starting month');
    if (!(Number.isInteger(input.repeatEvery) && input.repeatEvery! >= 2 && input.repeatEvery! <= 11)) {
      throw new RecurringError('EVERY_RANGE', 'The months between must be a whole number from 2 to 11');
    }
  }

  const id = input.id ?? uuidv7();
  // How it repeated before this save, so a change of repeat, month or day can move the first month it is owed for.
  const [before] = await database.db
    .select({ dayOfMonth: expenseTemplates.dayOfMonth, amountMinor: expenseTemplates.amountMinor })
    .from(expenseTemplates)
    .where(and(eq(expenseTemplates.id, id), eq(expenseTemplates.workspaceId, ws.workspaceId)));
  const beforeRepeat = (await billRepeats(database.db, ws)).get(id) ?? null;
  // Absent leaves an edited bill as it was; a new bill is monthly.
  const repeatNow: BillRepeatFacts | null =
    input.repeat === undefined
      ? beforeRepeat
      : input.repeat === 'yearly'
        ? { repeat: 'yearly', month: input.repeatMonth!, every: null }
        : input.repeat === 'months'
          ? { repeat: 'months', month: input.repeatMonth!, every: input.repeatEvery! }
          : null;
  const yearlyMonth: number | null = repeatNow?.month ?? null;
  const sameRepeat = (repeatNow?.repeat ?? null) === (beforeRepeat?.repeat ?? null) && yearlyMonth === (beforeRepeat?.month ?? null) && (repeatNow?.every ?? null) === (beforeRepeat?.every ?? null);
  const today = isoDate();
  const repeatChanged = Boolean(before) && (!sameRepeat || (yearlyMonth !== null && before!.dayOfMonth !== input.dayOfMonth));
  // The first occurrence on or after today, which an every-few-months bill counts its gaps from.
  const startsMonth = input.startsMonth ?? (yearlyMonth === null ? today.slice(0, 7) : nextOccurrenceMonth(today, yearlyMonth, input.dayOfMonth));

  // The sinking fund is worked out and checked BEFORE anything is written: a refusal leaves the bill as it was. (The
  // free-money check reads the whole book, which cannot be done from inside the transaction below.)
  const fundPlan =
    input.fund && yearlyMonth !== null
      ? await planFund(database, ws, input, {
          id,
          yearlyMonth,
          repeatNow,
          amountMinor,
          today,
          startsMonth: repeatChanged ? startsMonth : await storedStartsMonth(database.db, id, startsMonth),
          oldAmountMinor: before?.amountMinor ?? null,
        })
      : null;

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

    await withCapture(tx, [{ entity: 'bill', id }, { entity: 'bill_window', id }], async () => {
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
          .values({ templateId: id, workspaceId: ws.workspaceId, payByDay, startsMonth })
          // Changing how often it comes out starts the new schedule from today; any other edit leaves the first month alone.
          .onConflictDoUpdate({ target: billWindows.templateId, set: repeatChanged ? { payByDay, startsMonth } : { payByDay } });
      }
      if (input.repeat !== undefined) await writeBillRepeat(tx, ws, id, repeatNow);
      // Inside the capture, so a shared workspace sees the currency change with the rest of the bill.
      if (input.currency !== undefined) await writeBillCurrency(tx, ws, id, input.currency);
    });

    // The fund is the owner's own and does not sync, so it is written outside the capture; a refusal still undoes the bill.
    if (fundPlan) {
      const { existing, result } = fundPlan;
      if (!existing) {
        await writeSinkingFund(tx, ws, { billId: id, accountId: fundPlan.accountId, monthlyMinor: result.facts.monthlyMinor, startedMonth: result.facts.startedMonth, custom: result.custom });
      } else {
        await moveSinkingFund(tx, ws, id, fundPlan.accountId);
      }
      if (result.openingMinor !== undefined) await writeSinkingOpening(tx, ws, id, result.openingMinor, today);
      if (result.plan) await writeSinkingPlan(tx, ws, id, result.plan.from, result.plan.monthlyMinor, result.custom, today);
      else if (existing) await setSinkingCustom(tx, ws, id, result.custom);
    } else if (input.fund === null || yearlyMonth === null) {
      await dropSinkingFund(tx, ws, id);
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
  const currencies = await billCurrencies(database.db, ws);
  const repeats = await billRepeats(database.db, ws);
  return rows.map((row) => toRow(row, byTemplate.get(row.id), currencies.get(row.id) ?? null, repeats.get(row.id) ?? null));
}

export async function deleteExpenseTemplate(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  // In a transaction of its own so household sharing's capture sees the archive (spec §6.3).
  await database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'bill', id }, () =>
      tx
        .update(expenseTemplates)
        .set({ archivedAt: new Date().toISOString() })
        .where(and(eq(expenseTemplates.workspaceId, ws.workspaceId), eq(expenseTemplates.id, id))),
    );
    // Its saving is released with it.
    await dropSinkingFund(tx, ws, id);
  });
}

/**
 * What each category already owes to bills this month, so a budget can say how much of it is spoken
 * for. A bill with no fixed amount contributes nothing: guessing one would overstate the commitment.
 *
 * A bill's amount is in its own currency when it has one, else in the currency of the account that pays it, so the sum is brought into the currency the
 * workspace reads in, at the rate on the day the bill comes out — the day the money actually leaves, and the same
 * day the bills screen converts it on. That is also what stops a dollar bill and a rupiah bill being added
 * together as though they were the same money. A bill no rate reaches is named in `missing` rather than only
 * dropped: an understated commitment is worse than a stated gap.
 */
export async function committedByCategory(
  database: Database,
  ws: WorkspaceContext,
): Promise<{ committed: Record<string, number>; currency: string; missing: Unconverted[] }> {
  const templates = await listExpenseTemplates(database, ws);
  const money = await bookMoneyFor(database, ws, { foreign: true });
  const payers = new Map(
    (await database.db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId))).map((row) => [
      row.id,
      row.currency,
    ]),
  );
  const today = isoDate();
  // Each bill's month that speaks for this month: the calendar month, or by the workspace's "Month starts on" (0118).
  const startDay = await monthStartFor(database, ws);
  const monthOfBillNow = (template: ExpenseTemplateRow) => thisBillMonth(today, template.dayOfMonth, startDay);
  // A bill paused this month comes out for nothing, so none of the category is spoken for by it.
  const pausedNow = (await billPausesExist(database.db))
    ? new Set(
        (
          await database.db
            .select({ templateId: billPauses.templateId, month: billPauses.month })
            .from(billPauses)
            .where(eq(billPauses.workspaceId, ws.workspaceId))
        )
          .filter((row) => {
            const template = templates.find((t) => t.id === row.templateId);
            return template !== undefined && row.month === monthOfBillNow(template);
          })
          .map((row) => row.templateId),
      )
    : new Set<string>();
  const committed: Record<string, number> = {};
  for (const template of templates) {
    if (!template.active || template.amountMinor === null || pausedNow.has(template.id)) continue;
    // A yearly or every-few-months bill is spoken for only in a month it comes out, and only once it has begun.
    const month = monthOfBillNow(template);
    if (template.repeat !== 'monthly' && (!isOwedMonth(month, template.repeatMonth, template.repeatEvery, template.startsMonth) || month < template.startsMonth)) continue;
    // No rate reaching the bill's out day leaves it out rather than counting it as the wrong money — and says so
    // in `missing`, so the budget's "… of it is bills" line cannot quietly understate what is already spoken for.
    const outDay = billWindow(month, template.dayOfMonth, template.payByDay).opensOn;
    // A bill written in its own currency is converted even where the workspace reads in the owner's money (an SGD bill in
    // a rupiah one is the case this exists for); one that follows its payer is converted as it always was.
    const convert = template.currency ? (money.convertForeign ?? money.convert) : money.convert;
    const amountMinor = convert(template.amountMinor, template.currency ?? payers.get(template.moneyAccountId) ?? ws.baseCurrency, outDay);
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
  /** What it came to, which may differ from the template's amount. In `paidCurrency`. */
  paidMinor: number | null;
  /** The currency `paidMinor` is in: the bill's own for a foreign payment, else the account's that paid. Null: unpaid. */
  paidCurrency: string | null;
  /** What a foreign payment was charged in the paying account's money, and that money; null when nothing was converted. */
  chargedMinor: number | null;
  chargedCurrency: string | null;
  paymentId: string | null;
  /** The account that actually paid billMonth, which may not be the bill's default; null: unpaid or not found. */
  paidFromAccountId: string | null;
  /** The fixed amount, else what it came to the last time it was paid, else null. */
  estimateMinor: number | null;
  /** Months a payment can be recorded for, oldest unsettled first; a paused month last. */
  payableMonths: string[];
  /** YYYY-MM: the month a paused bill comes back; null when nothing from this month on is paused. */
  pausedUntil: string | null;
  /** YYYY-MM: the first month a pause made today would cover. */
  pauseFrom: string;
}

export interface BillHistoryRow {
  month: string;
  window: BillWindow;
  state: BillStateKind;
  days: number;
  paidOn: string | null;
  paidMinor: number | null;
  paidCurrency: string | null;
  chargedMinor: number | null;
  chargedCurrency: string | null;
  paymentId: string | null;
  /** The account that actually paid the month, which may not be the bill's default. */
  paidFromAccountId: string | null;
  /** Every posted payment of the month, newest first: a month may hold more than one. */
  payments: { id: string; paidMinor: number | null; paidCurrency: string | null; linked: boolean }[];
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
  /** What the category was charged, in the currency the payer holds. */
  amountMinor: number | null;
  /** That charge's currency. */
  currency: string | null;
  /** The bill's own figure when the payment was a foreign one: the original amount and currency of the purchase. */
  originalMinor: number | null;
  originalCurrency: string | null;
  /** The money account the payment came out of: the line opposite the category's. */
  payerAccountId: string | null;
  /**
   * True for a purchase that was already in the app and linked to the month afterwards; false for a payment Pay recorded.
   * The two are told apart by the purchase itself: Pay posts it with the bill's id (transactions.template_id), a link does not.
   */
  linked: boolean;
}

interface BillFacts {
  /** Per bill, newest payment first. */
  payments: Map<string, PaymentFact[]>;
  skips: Map<string, Set<string>>;
  pauses: Map<string, Set<string>>;
  /**
   * The workspace's "Month starts on" (0118): which of a bill's months is this month's. A bill keeps its day and its
   * months; with months from the 25th, a bill out on the 27th counts in November by its 27 October bill.
   */
  startDay: MonthStartDay;
}

/** Posted payments and skips for these bills. Without migration 0044 a payment settles the month it was made in. */
async function billFacts(database: Database, ws: WorkspaceContext, templates: ExpenseTemplateRow[]): Promise<BillFacts> {
  const ids = templates.map((t) => t.id);
  const payments = new Map<string, PaymentFact[]>();
  const skips = new Map<string, Set<string>>();
  const pauses = new Map<string, Set<string>>();
  const startDay = await monthStartFor(database, ws);
  if (ids.length === 0) return { payments, skips, pauses, startDay };

  const rows = (await billTablesExist(database.db))
    ? await database.db
        .select({
          templateId: billPayments.templateId,
          billMonth: billPayments.billMonth,
          transactionId: transactions.id,
          occurredOn: transactions.occurredOn,
          originalMinor: transactions.originalAmountMinor,
          originalCurrency: transactions.originalCurrency,
          paidBy: transactions.templateId,
        })
        .from(billPayments)
        .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
        .where(and(eq(billPayments.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(billPayments.templateId, ids)))
    : (
        await database.db
          .select({
            templateId: transactions.templateId,
            transactionId: transactions.id,
            occurredOn: transactions.occurredOn,
            originalMinor: transactions.originalAmountMinor,
            originalCurrency: transactions.originalCurrency,
          })
          .from(transactions)
          .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(transactions.templateId, ids)))
      ).map((row) => ({ ...row, templateId: row.templateId!, billMonth: row.occurredOn.slice(0, 7), paidBy: row.templateId }));

  const lines = rows.length === 0
    ? []
    : await database.db
        .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, kind: accounts.kind })
        .from(entries)
        .innerJoin(accounts, eq(accounts.id, entries.accountId))
        .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, rows.map((row) => row.transactionId))));
  const categoryOf = new Map(templates.map((t) => [t.id, t.categoryAccountId]));
  for (const row of rows) {
    // A purchase linked from another category has no line in the bill's own: its first expense line speaks for it.
    const own = lines.filter((l) => l.transactionId === row.transactionId);
    const line = own.find((l) => l.accountId === categoryOf.get(row.templateId)) ?? own.find((l) => l.kind === 'expense');
    const list = payments.get(row.templateId) ?? [];
    const others = own.filter((l) => l.accountId !== line?.accountId);
    const payer = others.find((l) => line && Math.sign(Number(l.amountMinor)) !== Math.sign(Number(line.amountMinor))) ?? others[0];
    const { paidBy, ...fact } = row;
    list.push({ ...fact, linked: paidBy === null, amountMinor: line ? Number(line.amountMinor) : null, currency: line?.currency ?? null, payerAccountId: payer?.accountId ?? null });
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
  const pauseRows = (await billPausesExist(database.db))
    ? await database.db
        .select({ templateId: billPauses.templateId, month: billPauses.month })
        .from(billPauses)
        .where(and(eq(billPauses.workspaceId, ws.workspaceId), inArray(billPauses.templateId, ids)))
    : [];
  for (const row of pauseRows) {
    const set = pauses.get(row.templateId) ?? new Set<string>();
    set.add(row.month);
    pauses.set(row.templateId, set);
  }
  return { payments, skips, pauses, startDay };
}

function settledOf(template: ExpenseTemplateRow, facts: BillFacts): Record<string, 'paid' | 'skipped' | 'paused'> {
  const settled: Record<string, 'paid' | 'skipped' | 'paused'> = {};
  for (const month of facts.pauses.get(template.id) ?? []) settled[month] = 'paused';
  // A month both paused and skipped was skipped.
  for (const month of facts.skips.get(template.id) ?? []) settled[month] = 'skipped';
  // A month both skipped and paid was paid.
  for (const payment of facts.payments.get(template.id) ?? []) settled[payment.billMonth] = 'paid';
  return settled;
}

/**
 * What a payment came to. A foreign one (a bill written in SGD, paid from a rupiah account) is posted in the payer's
 * money with the bill's own figure as the purchase's original amount: it came to the original, and was charged the
 * rest. Anything else came to what the category was charged, in the money that paid it.
 */
function paidFigures(payment: PaymentFact): { paidMinor: number | null; paidCurrency: string | null; chargedMinor: number | null; chargedCurrency: string | null } {
  if (payment.originalMinor !== null && payment.originalCurrency !== null && payment.originalCurrency !== payment.currency) {
    return { paidMinor: payment.originalMinor, paidCurrency: payment.originalCurrency, chargedMinor: payment.amountMinor, chargedCurrency: payment.currency };
  }
  return { paidMinor: payment.amountMinor, paidCurrency: payment.currency, chargedMinor: null, chargedCurrency: null };
}

function monthOfBill(template: ExpenseTemplateRow, facts: BillFacts, month: string, today: string): BillHistoryRow {
  const settled = settledOf(template, facts);
  const window = billWindow(month, template.dayOfMonth, template.payByDay);
  const payment = (facts.payments.get(template.id) ?? []).find((p) => p.billMonth === month) ?? null;
  const standing = billStanding(window, today, settled[month] ?? null);
  const paid = payment ? paidFigures(payment) : null;
  return {
    month,
    window,
    ...standing,
    paidOn: payment?.occurredOn ?? null,
    paidMinor: paid?.paidMinor ?? null,
    paidCurrency: paid?.paidCurrency ?? null,
    chargedMinor: paid?.chargedMinor ?? null,
    chargedCurrency: paid?.chargedCurrency ?? null,
    paymentId: payment?.transactionId ?? null,
    paidFromAccountId: payment?.payerAccountId ?? null,
    payments: (facts.payments.get(template.id) ?? [])
      .filter((p) => p.billMonth === month)
      .map((p) => ({ id: p.transactionId, paidMinor: paidFigures(p).paidMinor, paidCurrency: paidFigures(p).paidCurrency, linked: p.linked })),
  };
}

const paidMinorOf = (payment: PaymentFact | undefined) => (payment ? paidFigures(payment).paidMinor : null);

function billRow(template: ExpenseTemplateRow, facts: BillFacts, today: string): MonthlyBill {
  const settled = settledOf(template, facts);
  const input = linkInput(template, facts, today);
  const thisMonth = thisBillMonth(today, template.dayOfMonth, facts.startDay);
  const { month, ...rest } = monthOfBill(template, facts, currentBillMonth(input), today);
  return {
    ...template,
    billMonth: month,
    ...rest,
    estimateMinor: template.amountMinor ?? paidMinorOf(facts.payments.get(template.id)?.[0]) ?? null,
    payableMonths: payableBillMonths(input),
    pausedUntil: pausedUntil(facts.pauses.get(template.id) ?? [], today, thisMonth),
    pauseFrom: pauseStart(today, settled, thisMonth),
  };
}

/**
 * Every active recurring bill, and where the month it speaks for stands on `onDate`.
 *
 * A bill belongs to the month it comes out, and a payment settles the month it names — so internet paid on
 * 3 September for August settles August, and September's bill is still to come.
 */
export async function monthlyBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  // A yearly bill is owed only in its own month: the rest of the year it is not here (see `yearlyBills`), so no total,
  // budget or list that builds on this one counts it.
  return (await allBills(database, ws, onDate)).filter((bill) => bill.repeat === 'monthly' || yearlyListed(bill, bill.window, onDate));
}

/** Every active yearly or every-few-months bill, listed or not, with its next occurrence: the page that keeps them reachable all year. */
export async function yearlyBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  return (await allBills(database, ws, onDate))
    .filter((bill) => bill.repeat !== 'monthly')
    .sort((a, b) => a.window.opensOn.localeCompare(b.window.opensOn) || a.name.localeCompare(b.name));
}

async function allBills(database: Database, ws: WorkspaceContext, onDate: string): Promise<MonthlyBill[]> {
  const templates = (await listExpenseTemplates(database, ws)).filter((template) => template.active);
  const facts = await billFacts(database, ws, templates);
  return templates
    .map((template) => billRow(template, facts, onDate))
    .sort((a, b) => a.window.payBy.localeCompare(b.window.payBy) || a.name.localeCompare(b.name));
}

/** A bill in any month: where that month stands, and what it is expected to come to. */
export interface BillMonthRow extends BillHistoryRow {
  bill: ExpenseTemplateRow;
  /** The fixed amount, else what it came to the last time it was paid. */
  estimateMinor: number | null;
}

/**
 * Every active bill owed in `month` (its repeat, on or after its first month), where that month stands on `today`.
 * Skipped and paused months are included with their state. The open book's bills only, as `listExpenseTemplates` is.
 */
export async function billsInMonth(
  database: Database,
  ws: WorkspaceContext,
  month: string,
  today: string,
  /**
   * `month` is one of the workspace's own months ("Month starts on", 0118), not a bill month: each bill is read for
   * the bill month whose day falls inside it (`billMonthIn`). Off, `month` is every bill's bill month, as the debt
   * plan's calendar reads it.
   */
  opts: { workspaceMonth?: boolean; paidBeforeStart?: boolean } = {},
): Promise<BillMonthRow[]> {
  const startDay = opts.workspaceMonth ? await monthStartFor(database, ws) : 1;
  const billMonthOf = (template: ExpenseTemplateRow) => billMonthIn(month, template.dayOfMonth, startDay);
  const started = (template: ExpenseTemplateRow) => billMonthOf(template) >= template.startsMonth;
  const candidates = (await listExpenseTemplates(database, ws)).filter(
    (template) => template.active && (started(template) || opts.paidBeforeStart) && isOwedMonth(billMonthOf(template), template.repeatMonth, template.repeatEvery, template.startsMonth),
  );
  const facts = await billFacts(database, ws, candidates);
  // `paidBeforeStart`: a month before the bill was tracked is listed too once a payment is linked to it (Link an
  // earlier month), as the bill's own history lists it — paid, never owed.
  const templates = candidates.filter((template) => started(template) || (facts.payments.get(template.id) ?? []).some((payment) => payment.billMonth === billMonthOf(template)));
  return templates
    .map((template) => ({
      ...monthOfBill(template, facts, billMonthOf(template), today),
      bill: template,
      estimateMinor: template.amountMinor ?? paidMinorOf(facts.payments.get(template.id)?.[0]) ?? null,
    }))
    .sort((a, b) => a.window.payBy.localeCompare(b.window.payBy) || a.bill.name.localeCompare(b.bill.name));
}

/** One bill with its months, newest first: every month paid or skipped, and every month since it was tracked. */
export async function billDetail(database: Database, ws: WorkspaceContext, templateId: string, onDate: string): Promise<BillDetail> {
  const template = (await listExpenseTemplates(database, ws)).find((t) => t.id === templateId);
  if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
  const facts = await billFacts(database, ws, [template]);
  // Paused months ahead are listed too, so the history says which months will not come.
  const yearlyMonth = template.repeatMonth;
  // A yearly bill has a month of history a year, never the eleven it was not owed in (a pause covers those too).
  const months = new Set<string>(
    [
      ...(facts.skips.get(template.id) ?? []),
      ...(facts.pauses.get(template.id) ?? []),
      ...(facts.payments.get(template.id) ?? []).map((p) => p.billMonth),
    ].filter((month) => isOwedMonth(month, yearlyMonth, template.repeatEvery, template.startsMonth)),
  );
  // Up to this month's bill, which a workspace whose months start later may already have in next calendar month.
  const upTo = [monthOf(onDate), thisBillMonth(onDate, template.dayOfMonth, facts.startDay)].sort().at(-1)!;
  for (let month = template.startsMonth; month <= upTo; month = addMonths(month, 1)) {
    if (isOwedMonth(month, yearlyMonth, template.repeatEvery, template.startsMonth)) months.add(month);
  }
  const history = [...months]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, yearlyMonth === null ? 12 : 6)
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
  await database.transaction((tx) =>
    withCapture(tx, { entity: 'bill_skip', id: `${templateId}|${month}` }, () =>
      tx
        .insert(billSkips)
        .values({ workspaceId: ws.workspaceId, templateId, month, createdAt: new Date().toISOString() })
        .onConflictDoNothing(),
    ),
  );
}

/** Takes back a skip, so the bill is owed again. */
export async function unskipBill(database: Database, ws: WorkspaceContext, templateId: string, month: string): Promise<void> {
  await database.transaction((tx) =>
    withCapture(tx, { entity: 'bill_skip', id: `${templateId}|${month}` }, () =>
      tx.delete(billSkips).where(and(eq(billSkips.workspaceId, ws.workspaceId), eq(billSkips.templateId, templateId), eq(billSkips.month, month))),
    ),
  );
}

/**
 * Pauses a bill from the first month not already paid or skipped up to, not including, `until` — the month it comes
 * back. Each paused month is a row of its own, so the months read back one by one and a resume can take back the rest.
 */
export async function pauseBill(database: Database, ws: WorkspaceContext, templateId: string, until: string, today: string = isoDate()): Promise<string[]> {
  if (!BILL_MONTH.test(until)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  if (!(await billPausesExist(database.db))) throw new RecurringError('NO_PAUSES', 'This database cannot pause a bill yet');
  const template = (await listExpenseTemplates(database, ws)).find((t) => t.id === templateId);
  if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
  const facts = await billFacts(database, ws, [template]);
  const months = pausedMonths(pauseStart(today, settledOf(template, facts), thisBillMonth(today, template.dayOfMonth, facts.startDay)), until);
  if (months.length === 0) throw new RecurringError('PAUSE_RANGE', 'A bill comes back after the months it is paused for');
  await database.transaction((tx) =>
    withCapture(
      tx,
      months.map((month) => ({ entity: 'bill_pause', id: `${templateId}|${month}` })),
      async () => {
        for (const month of months) {
          await tx.insert(billPauses).values({ workspaceId: ws.workspaceId, templateId, month, createdAt: new Date().toISOString() }).onConflictDoNothing();
        }
      },
    ),
  );
  return months;
}

/** Brings a paused bill back from this month: its paused months from today on are taken back; earlier ones stay. */
export async function resumeBill(database: Database, ws: WorkspaceContext, templateId: string, today: string = isoDate()): Promise<void> {
  if (!(await billPausesExist(database.db))) return;
  // From this month's bill: the calendar month, or by the workspace's "Month starts on" (0118) — the month the bills
  // page shows as paused now.
  const template = (await listExpenseTemplates(database, ws)).find((t) => t.id === templateId);
  const from = template ? thisBillMonth(today, template.dayOfMonth, await monthStartFor(database, ws)) : monthOf(today);
  await database.transaction(async (tx) => {
    const ahead = (
      await tx
        .select({ month: billPauses.month })
        .from(billPauses)
        .where(and(eq(billPauses.workspaceId, ws.workspaceId), eq(billPauses.templateId, templateId), sql`${billPauses.month} >= ${from}`))
    ).map((row) => row.month);
    if (ahead.length === 0) return;
    await withCapture(
      tx,
      ahead.map((month) => ({ entity: 'bill_pause', id: `${templateId}|${month}` })),
      () =>
        tx
          .delete(billPauses)
          .where(and(eq(billPauses.workspaceId, ws.workspaceId), eq(billPauses.templateId, templateId), sql`${billPauses.month} >= ${from}`)),
    );
  });
}

export interface BillPaymentInput {
  templateId: string;
  /** YYYY-MM: which month's bill this pays. */
  billMonth: string;
  /** What the bill came to, in the bill's own currency (the paying account's, for a bill that follows its payer). */
  amountMinor: number;
  /**
   * What the paying account was charged, in its own currency. Required when the bill is written in another currency
   * than the account's (an SGD bill paid from a rupiah account): the bank's figure, which is what leaves the account.
   * Ignored when the two currencies match.
   */
  chargedMinor?: number | null;
  /** The account that paid; the bill's own when absent. */
  moneyAccountId?: string;
  /** Which goal the money came out of, when it took more than was free (spec §4.4). */
  setAside?: SetAsideChoice | null;
  /**
   * A bill with a sinking fund, paid on a credit card: also pay the card from the fund's account, for the same amount.
   * Either way the fund is released when the bill is paid.
   */
  payCardFromFund?: boolean;
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
        .select({ id: accounts.id, name: accounts.name, kind: accounts.kind, currency: accounts.currency })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.id, payment.moneyAccountId ?? template.moneyAccountId)));
      if (!wallet || (wallet.kind !== 'asset' && wallet.kind !== 'liability')) {
        throw new RecurringError('NOT_A_WALLET', 'A bill is paid from an account or a card');
      }
      if (await isSettled(tx, ws, template.id, payment.billMonth)) {
        throw new RecurringError('ALREADY_SETTLED', `${template.name} is already settled for that month`);
      }
      const currency = wallet.currency ?? ws.baseCurrency;
      const billCurrency = (await billCurrencies(tx, ws)).get(template.id) ?? currency;
      const foreign = billCurrency !== currency;
      if (foreign && !(Number.isSafeInteger(payment.chargedMinor) && payment.chargedMinor! > 0)) {
        throw new RecurringError('CHARGED_REQUIRED', `Enter what the account was charged in ${currency}`);
      }
      // Checked before anything is posted: the fund's account and the card must hold the same money.
      const fund = await getSinkingFund(tx, ws, template.id);
      let cardFromFund = false;
      if (fund && payment.payCardFromFund && wallet.kind === 'liability' && wallet.id !== fund.accountId) {
        if (((await accountCurrency(tx, ws, fund.accountId)) ?? ws.baseCurrency) !== currency) throw new RecurringError('FUND_CURRENCY', `The card is in ${currency}, the fund's account is not`);
        cardFromFund = true;
      }
      const paid = await postTransactionTx(tx, ws, {
          occurredOn: input.paidOn,
          description: template.name,
          templateId: template.id,
          billMonth: payment.billMonth,
          ratesToBase: input.ratesToBase,
          setAside: payment.setAside,
          // A foreign bill posts what the bank charged, in the payer's money, and keeps the bill's own figure as the
          // original amount: the same shape as a purchase made abroad on a card (the rate is the ratio of the two).
          lines: expenseLines({
            categoryAccountId: template.categoryAccountId,
            paymentAccountId: payment.moneyAccountId ?? template.moneyAccountId,
            amountMinor: foreign ? payment.chargedMinor! : payment.amountMinor,
            currency,
          }),
          ...(foreign ? { originalCurrency: billCurrency, originalAmountMinor: payment.amountMinor } : {}),
        });
      ids.push(paid);
      await recordActivityTx(tx, ws, 'payment', paid, { templateId: template.id, billMonth: payment.billMonth });
      // A bill that was saving up is paid: the money set aside for it is let go, and when it went on a card the card
      // is paid from the fund's account for what it was charged — all in this one transaction.
      if (fund) {
        if (cardFromFund) {
          ids.push(
            await postTransactionTx(tx, ws, {
              occurredOn: input.paidOn,
              description: `${wallet.name} payment`,
              lines: transferLines({ fromAccountId: fund.accountId, toAccountId: wallet.id, amountMinor: foreign ? payment.chargedMinor! : payment.amountMinor, currency }),
              fileTransfer: true,
            }),
          );
        }
        await dropSinkingFund(tx, ws, template.id);
      }
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

/* ------------------------------------------------------------------------------------------------------------------
 * Linking a purchase that is already in the ledger to a bill's month.
 *
 * Pay posts a purchase and its bill_payments row together. A link writes only the row, for a purchase that was entered
 * by hand: nothing is posted, voided or moved, so no balance, budget or report changes. The two are told apart by the
 * purchase itself: Pay stamps transactions.template_id, a link leaves it null (so no schema column is needed).
 * ------------------------------------------------------------------------------------------------------------------ */

export interface LinkPurchaseInput {
  templateId: string;
  /** YYYY-MM: the bill's month the purchase settles. */
  billMonth: string;
  transactionId: string;
  /** The day the screen is read on; today when absent. Months after the bill's latest payable month are refused. */
  today?: string;
}

/** A bill's schedule and settled months as the link rules read them on a day. */
function linkInput(template: ExpenseTemplateRow, facts: BillFacts, today: string) {
  return {
    today,
    startsMonth: template.startsMonth,
    outDay: template.dayOfMonth,
    payByDay: template.payByDay,
    settled: settledOf(template, facts),
    yearlyMonth: template.repeatMonth,
    repeatEvery: template.repeatEvery,
    startDay: facts.startDay,
  };
}

/** The newest month a purchase may be linked to (see `latestLinkMonth` in core): a yearly bill's next one can be paid early. */
function latestLinkMonth(template: ExpenseTemplateRow, facts: BillFacts, today: string): string {
  return latestLinkMonthOf(linkInput(template, facts, today));
}

async function liveTemplate(database: Database, ws: WorkspaceContext, templateId: string): Promise<ExpenseTemplateRow> {
  const template = (await listExpenseTemplates(database, ws)).find((t) => t.id === templateId);
  if (!template) throw new RecurringError('NOT_FOUND', 'That bill is not here');
  return template;
}

/** Why a month of a bill cannot take a purchase, or null when it can. Read by a screen before it offers the link; `linkPurchaseToBill` asks the same. */
export async function billLinkRefusal(
  database: Database,
  ws: WorkspaceContext,
  input: { templateId: string; billMonth: string; today?: string },
): Promise<{ code: 'NOT_OWED' | 'MONTH_AHEAD' | 'SKIPPED' | 'PAUSED' | 'ALREADY_SETTLED'; message: string } | null> {
  if (!BILL_MONTH.test(input.billMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  const template = await liveTemplate(database, ws, input.templateId);
  const facts = await billFacts(database, ws, [template]);
  const { billMonth } = input;
  if (!isOwedMonth(billMonth, template.repeatMonth, template.repeatEvery, template.startsMonth)) {
    return { code: 'NOT_OWED', message: `${template.name} does not come out in that month` };
  }
  if (billMonth > latestLinkMonth(template, facts, input.today ?? isoDate())) return { code: 'MONTH_AHEAD', message: 'That month is not out yet' };
  if ((facts.skips.get(template.id) ?? new Set()).has(billMonth)) return { code: 'SKIPPED', message: 'That month is skipped. Unskip it first.' };
  // A paused month has no bill to settle, as a skipped one has none: refused alike. Pay may still record one on purpose.
  if ((facts.pauses.get(template.id) ?? new Set()).has(billMonth)) return { code: 'PAUSED', message: 'That month is paused. Resume the bill first.' };
  if (await isSettled(database.db, ws, template.id, billMonth)) return { code: 'ALREADY_SETTLED', message: `${template.name} is already settled for that month` };
  return null;
}

/**
 * The month of a bill a purchase is linked to when none is picked, and `ask`: whether a tap should open the month page
 * first rather than link (`linkChoice` in core), or a link to that month would be refused as paid, skipped, paused or
 * not out yet. `opensOn` is the day that month comes out. `billLinkRefusal` is still the word on a link.
 */
export async function billLinkMonth(
  database: Database,
  ws: WorkspaceContext,
  input: { templateId: string; purchasedOn: string; today?: string },
): Promise<BillLinkMonth> {
  const template = await liveTemplate(database, ws, input.templateId);
  return (await linkMonthsOf(database, ws, [template], input.purchasedOn, input.today ?? isoDate()))[template.id]!;
}

export interface BillLinkMonth {
  month: string;
  ask: boolean;
  opensOn: string;
}

/** `billLinkMonth` for many bills at once, keyed by bill id: one read of the bills and their months for all of them. */
export async function billLinkMonths(
  database: Database,
  ws: WorkspaceContext,
  input: { templateIds: readonly string[]; purchasedOn: string; today?: string },
): Promise<Record<string, BillLinkMonth>> {
  if (input.templateIds.length === 0) return {};
  const wanted = new Set(input.templateIds);
  const templates = (await listExpenseTemplates(database, ws)).filter((t) => wanted.has(t.id));
  return linkMonthsOf(database, ws, templates, input.purchasedOn, input.today ?? isoDate());
}

async function linkMonthsOf(database: Database, ws: WorkspaceContext, templates: ExpenseTemplateRow[], purchasedOn: string, today: string): Promise<Record<string, BillLinkMonth>> {
  const facts = await billFacts(database, ws, templates);
  return Object.fromEntries(
    templates.map((template) => {
      const rules = linkInput(template, facts, today);
      const { month, ask } = linkChoice(purchasedOn, rules);
      // A month a link would be refused for (paid, skipped, paused, not out yet) is asked about too, so a list says so first.
      const shut = rules.settled[month] !== undefined || month > latestLinkMonthOf(rules);
      return [template.id, { month, ask: ask || shut, opensOn: billWindow(month, template.dayOfMonth, template.payByDay).opensOn }];
    }),
  );
}

/** Links a purchase already recorded to one month of a bill, so that month reads as paid with the purchase's own date and amount. */
export async function linkPurchaseToBill(database: Database, ws: WorkspaceContext, input: LinkPurchaseInput): Promise<void> {
  const { templateId, billMonth, transactionId } = input;
  if (!BILL_MONTH.test(billMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  if (!(await billTablesExist(database.db))) throw new RecurringError('NO_LINKS', 'This database cannot link a purchase to a bill yet');
  const refusal = await billLinkRefusal(database, ws, { templateId, billMonth, today: input.today });
  if (refusal) throw new RecurringError(refusal.code, refusal.message);
  await database.transaction(async (tx) => {
    const [purchase] = await tx
      .select({ id: transactions.id, status: transactions.status })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!purchase || purchase.status !== 'posted') throw new RecurringError('NOT_A_PURCHASE', 'That purchase is not here');
    const spent = await tx.values<[number]>(sql`
      SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId} AND a.kind = 'expense' AND e.amount_minor > 0 LIMIT 1`);
    if (spent.length === 0) throw new RecurringError('NOT_A_PURCHASE', 'Only a purchase can be linked to a bill');
    const [already] = await tx.select({ month: billPayments.billMonth }).from(billPayments).where(eq(billPayments.transactionId, transactionId));
    if (already) throw new RecurringError('ALREADY_LINKED', 'That purchase is already linked to a bill');
    if (await isSettled(tx, ws, templateId, billMonth)) throw new RecurringError('ALREADY_SETTLED', 'That month is already settled');
    await captureBillLinkingTx(tx, transactionId);
    await tx.insert(billPayments).values({ transactionId, workspaceId: ws.workspaceId, templateId, billMonth });
  });
}

/**
 * Moves a purchase's link to another month or another bill, in one step: the month it settled is owed again and the new
 * one is paid by it, or neither changes (a refusal rolls both back). The same bill and month is no change at all, and a
 * purchase linked to nothing is simply linked. A payment Pay recorded is refused (NOT_LINKED): it is undone on its bill.
 */
export async function relinkPurchaseToBill(database: Database, ws: WorkspaceContext, input: LinkPurchaseInput): Promise<void> {
  const { templateId, billMonth, transactionId } = input;
  if (!BILL_MONTH.test(billMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  if (!(await billTablesExist(database.db))) throw new RecurringError('NO_LINKS', 'This database cannot link a purchase to a bill yet');
  const current = await billOfPurchase(database, ws, transactionId);
  if (!current) return linkPurchaseToBill(database, ws, input);
  if (!current.linked) throw new RecurringError('NOT_LINKED', 'That payment was recorded from the bill. Undo it there.');
  if (current.templateId === templateId && current.billMonth === billMonth) return;
  const refusal = await billLinkRefusal(database, ws, { templateId, billMonth, today: input.today });
  if (refusal) throw new RecurringError(refusal.code, refusal.message);
  await database.transaction(async (tx) => {
    await captureBillLinkingTx(tx, transactionId);
    // Read again inside the transaction: what is moved is the link as it stands now.
    const [row] = await tx
      .select({ paidBy: transactions.templateId, status: transactions.status })
      .from(billPayments)
      .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
      .where(and(eq(billPayments.transactionId, transactionId), eq(billPayments.workspaceId, ws.workspaceId)));
    if (!row || row.status !== 'posted') throw new RecurringError('NOT_A_PURCHASE', 'That purchase is not here');
    if (row.paidBy !== null) throw new RecurringError('NOT_LINKED', 'That payment was recorded from the bill. Undo it there.');
    await tx.delete(billPayments).where(and(eq(billPayments.transactionId, transactionId), eq(billPayments.workspaceId, ws.workspaceId)));
    if (await isSettled(tx, ws, templateId, billMonth)) throw new RecurringError('ALREADY_SETTLED', 'That month is already settled');
    await tx.insert(billPayments).values({ transactionId, workspaceId: ws.workspaceId, templateId, billMonth });
  });
}

/** Takes a link back: only the bill's claim on the purchase goes, the purchase itself is untouched. A payment Pay recorded is refused (undo voids it). */
export function unlinkPurchaseFromBill(database: Database, ws: WorkspaceContext, input: { transactionId: string }): Promise<void> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({ paidBy: transactions.templateId })
      .from(billPayments)
      .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
      .where(and(eq(billPayments.transactionId, input.transactionId), eq(billPayments.workspaceId, ws.workspaceId)));
    if (!row) return;
    if (row.paidBy !== null) throw new RecurringError('NOT_LINKED', 'That payment was recorded from the bill. Undo it there.');
    await captureBillLinkingTx(tx, input.transactionId);
    await tx.delete(billPayments).where(and(eq(billPayments.transactionId, input.transactionId), eq(billPayments.workspaceId, ws.workspaceId)));
  });
}

/** The bill a purchase is linked to, and the month; null when it is linked to none. `linked` is false for a payment Pay recorded. */
export async function billOfPurchase(database: Database, ws: WorkspaceContext, transactionId: string): Promise<{ templateId: string; name: string; billMonth: string; linked: boolean } | null> {
  if (!(await billTablesExist(database.db))) return null;
  const [row] = await database.db
    .select({ templateId: billPayments.templateId, billMonth: billPayments.billMonth, name: expenseTemplates.name, paidBy: transactions.templateId })
    .from(billPayments)
    .innerJoin(transactions, eq(transactions.id, billPayments.transactionId))
    .innerJoin(expenseTemplates, eq(expenseTemplates.id, billPayments.templateId))
    .where(and(eq(billPayments.transactionId, transactionId), eq(billPayments.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')));
  return row ? { templateId: row.templateId, name: row.name, billMonth: row.billMonth, linked: row.paidBy === null } : null;
}

export interface BillLinkCandidate {
  transactionId: string;
  occurredOn: string;
  description: string;
  /** What the purchase came to: the bill's own figure for a foreign one, else what the category was charged. */
  amountMinor: number;
  currency: string;
  /** The money account it came out of. */
  payerAccountId: string | null;
  /** Within a tenth of the bill's amount. Always false for a bill with no fixed amount, or a figure in another money. */
  isClose: boolean;
}

/** The bill's category purchases that are posted, are expenses and are linked to no bill, newest first. */
async function categoryPurchases(database: Database, ws: WorkspaceContext, template: ExpenseTemplateRow, month: string | null): Promise<BillLinkCandidate[]> {
  const db = database.db;
  const rows = await db
    .select({
      transactionId: transactions.id,
      occurredOn: transactions.occurredOn,
      description: transactions.description,
      originalMinor: transactions.originalAmountMinor,
      originalCurrency: transactions.originalCurrency,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        ...(month ? [sql`substr(${transactions.occurredOn}, 1, 7) = ${month}`] : []),
        sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id = ${template.categoryAccountId} AND amount_minor > 0)`,
        sql`${transactions.id} NOT IN (SELECT transaction_id FROM bill_payments)`,
      ),
    )
    .orderBy(sql`${transactions.occurredOn} DESC`, sql`${transactions.createdAt} DESC`);
  if (rows.length === 0) return [];
  const lines = await db
    .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency })
    .from(entries)
    .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, rows.map((r) => r.transactionId))));
  const payerCurrency = (await accountCurrency(db, ws, template.moneyAccountId)) ?? ws.baseCurrency;
  const billCurrency = template.currency ?? payerCurrency;
  return rows.map((row) => {
    const own = lines.filter((l) => l.transactionId === row.transactionId);
    const line = own.find((l) => l.accountId === template.categoryAccountId && Number(l.amountMinor) > 0)!;
    const payer = own.find((l) => l.accountId !== template.categoryAccountId && Number(l.amountMinor) < 0);
    const foreign = row.originalMinor !== null && row.originalCurrency !== null && row.originalCurrency !== line.currency;
    const amountMinor = foreign ? row.originalMinor! : Number(line.amountMinor);
    const currency = foreign ? row.originalCurrency! : line.currency;
    const isClose = template.amountMinor !== null && currency === billCurrency && Math.abs(amountMinor - template.amountMinor) * 10 <= template.amountMinor;
    return { transactionId: row.transactionId, occurredOn: row.occurredOn, description: row.description ?? '', amountMinor, currency, payerAccountId: payer?.accountId ?? null, isClose };
  });
}

/** Purchases that could settle one month of a bill: in its category, dated in that month, not linked yet; newest first. */
export async function billLinkCandidates(database: Database, ws: WorkspaceContext, input: { templateId: string; billMonth: string }): Promise<BillLinkCandidate[]> {
  if (!BILL_MONTH.test(input.billMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  if (!(await billTablesExist(database.db))) return [];
  const template = await liveTemplate(database, ws, input.templateId);
  return categoryPurchases(database, ws, template, input.billMonth);
}

export interface BillEarlierMonth {
  month: string;
  /** Unlinked purchases in the bill's category dated in the month. */
  count: number;
  /** How many of them are within a tenth of the bill's amount. */
  closeCount: number;
}

export interface BillEarlierMonths {
  months: BillEarlierMonth[];
  /** The next month to ask from for the following page; null when nothing earlier is left to list. */
  nextFrom: string | null;
}

/**
 * The months before a bill started that a purchase could be linked to, newest first: from `fromMonth` (the month before the
 * start when absent) back `limitMonths` months, never past the earliest purchase in the category. A month already paid or
 * skipped is left out, and so is one the bill does not come out in.
 */
export async function billMonthsBefore(
  database: Database,
  ws: WorkspaceContext,
  input: { templateId: string; fromMonth?: string; limitMonths?: number },
): Promise<BillEarlierMonths> {
  if (input.fromMonth !== undefined && !BILL_MONTH.test(input.fromMonth)) throw new RecurringError('MONTH_FORMAT', 'A month is written YYYY-MM');
  if (!(await billTablesExist(database.db))) return { months: [], nextFrom: null };
  const template = await liveTemplate(database, ws, input.templateId);
  const facts = await billFacts(database, ws, [template]);
  const settled = settledOf(template, facts);
  const purchases = (await categoryPurchases(database, ws, template, null)).filter((p) => p.occurredOn.slice(0, 7) < template.startsMonth);
  if (purchases.length === 0) return { months: [], nextFrom: null };
  const earliest = purchases.reduce((min, p) => (p.occurredOn < min ? p.occurredOn : min), purchases[0]!.occurredOn).slice(0, 7);
  const limit = Math.max(1, input.limitMonths ?? 12);
  const months: BillEarlierMonth[] = [];
  let month = input.fromMonth ?? addMonths(template.startsMonth, -1);
  if (month >= template.startsMonth) month = addMonths(template.startsMonth, -1);
  let walked = 0;
  for (; month >= earliest && walked < limit; month = addMonths(month, -1), walked += 1) {
    if (settled[month] === 'paid' || settled[month] === 'skipped') continue;
    if (!isOwedMonth(month, template.repeatMonth, template.repeatEvery, template.startsMonth)) continue;
    const inMonth = purchases.filter((p) => p.occurredOn.slice(0, 7) === month);
    months.push({ month, count: inMonth.length, closeCount: inMonth.filter((p) => p.isClose).length });
  }
  return { months, nextFrom: month >= earliest ? month : null };
}
