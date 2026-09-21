import { isMcc, isSupportedCurrency, planPosting, type PostingLine, uuidv7 } from '@expanses/core';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, auditLog, entries, transactions } from '../schema';
import { bookTransactions } from '../schema-books';
import { cardPostings, cardSettlements } from '../schema-cards';
import { goals } from '../schema-goals';
import { transactionPointActuals } from '../schema-points';
import { billPayments, expenseTemplates } from '../schema-recurring';
import { BILL_MONTH, billTablesExist } from './bill-months';
import { type BookMoney, bookMoneyFor, type Unconverted } from './book-currency';
import { bookOfCategory, hasBooks } from './books';
import { followDepositEventTx, reopenDepositEventTx } from './deposit-event-log';
import { carryEventItemTx } from './event-items';
import {
  applySetAsideTx,
  carryable,
  carryAnswerTx,
  carryTaggedTx,
  goalActiveTx,
  parkForGoalTx,
  sameAnswer,
  type SetAsideChoice,
  setAsideChoiceOfTx,
  setAsideTablesExist,
  taggedMoveOfTx,
  takeBackTaggedArrivalTx,
  undoSetAsideTx,
  type VoidKeep,
  withSavedStage,
} from './set-aside-tx';
import { extrasFor, extrasForTx, extrasTablesExist, movePhotosTx, writeExtrasTx } from './transaction-extras';

export type TransactionSource = 'manual' | 'csv' | 'voice' | 'receipt' | 'email';

export type LedgerErrorCode = 'INVALID_DATE' | 'NOT_FOUND' | 'ALREADY_VOID' | 'INVALID_ORIGINAL' | 'INVALID_MCC' | 'TWO_BOOKS' | 'OTHER_BOOK' | 'INVALID_BILL_MONTH' | 'POCKET_PARENT';

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export interface PostTransactionInput {
  occurredOn: string;
  description: string;
  lines: PostingLine[];
  ratesToBase?: Record<string, number>;
  source?: TransactionSource;
  externalRef?: string | null;
  replacesTransactionId?: string | null;
  /** Currency and amount of a card purchase before the issuer converted it. Both or neither. */
  originalCurrency?: string | null;
  originalAmountMinor?: number | null;
  /** Merchant category code typed for the purchase, when the user knows it. */
  mcc?: string | null;
  /** The card the purchase was made on, when the account carries more than one. */
  cardId?: string | null;
  /** The recurring bill this settles, so the month stops being asked for. */
  templateId?: string | null;
  /** YYYY-MM: the month whose bill a template payment settles. Defaults to the month of occurredOn. */
  billMonth?: string | null;
  /** Online or offline, when the user said; null when they did not. Never guessed. */
  channel?: 'online' | 'offline' | null;
  /** Leaves the chart, the budgets and the category totals; balances, statements, points and net worth keep it. */
  excludedFromReport?: boolean;
  /** The event this belongs to. The column exists already; only the form is new. */
  eventId?: string | null;
  /** Photo rows written before the transaction had an id. */
  photoIds?: string[];
  /**
   * Which goal the money came out of, when it took more than was free (spec §4.4). Applied inside this posting;
   * undefined on `replaceTransaction` means "carry the original's", null means none.
   */
  setAside?: SetAsideChoice | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function audit(tx: Db, ws: WorkspaceContext, action: string, entityId: string, payload: unknown) {
  await tx.insert(auditLog).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    action,
    entity: 'transaction',
    entityId,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  });
}

/**
 * The book a posting belongs to: the one its income and expense lines are filed in, or none when it has no
 * category lines at all. Refuses a posting whose categories come from two books.
 */
async function bookOfCategories(tx: Db, lineAccounts: readonly { id: string; kind: string }[]): Promise<string | undefined> {
  const bookIds = new Set<string>();
  for (const account of lineAccounts) {
    if (account.kind !== 'income' && account.kind !== 'expense') continue;
    const owner = await bookOfCategory(tx, account.id);
    if (owner) bookIds.add(owner);
  }
  // "Spend" would be wrong for the income and refund sides this also guards, and for a form that mixed the
  // two by accident the fix is the same: pick the categories from one workspace.
  if (bookIds.size > 1) throw new LedgerError('TWO_BOOKS', 'A transaction cannot belong to two workspaces at once. Pick categories from one workspace.');
  const [bookId] = bookIds;
  return bookId;
}

/** Posts inside an open transaction. Throws PostingError or LedgerError without writing on invalid input. */
export async function postTransactionTx(tx: Db, ws: WorkspaceContext, input: PostTransactionInput): Promise<string> {
  if (!DATE.test(input.occurredOn)) {
    throw new LedgerError('INVALID_DATE', `occurredOn must be YYYY-MM-DD, got "${input.occurredOn}"`);
  }
  const originalCurrency = input.originalCurrency ?? null;
  const originalAmountMinor = input.originalAmountMinor ?? null;
  if ((originalCurrency === null) !== (originalAmountMinor === null)) {
    throw new LedgerError('INVALID_ORIGINAL', 'Original currency and original amount must be given together');
  }
  if (originalCurrency !== null && !isSupportedCurrency(originalCurrency)) {
    throw new LedgerError('INVALID_ORIGINAL', `Unsupported original currency "${originalCurrency}"`);
  }
  if (originalAmountMinor !== null && (!Number.isSafeInteger(originalAmountMinor) || originalAmountMinor <= 0)) {
    throw new LedgerError('INVALID_ORIGINAL', 'Original amount must be a positive whole number of minor units');
  }
  const mcc = input.mcc ?? null;
  if (mcc !== null && !isMcc(mcc)) throw new LedgerError('INVALID_MCC', `An MCC is four digits, got "${mcc}"`);
  if (input.billMonth != null && !BILL_MONTH.test(input.billMonth)) {
    throw new LedgerError('INVALID_BILL_MONTH', `A bill month is YYYY-MM, got "${input.billMonth}"`);
  }
  const ids = [...new Set(input.lines.map((l) => l.accountId))];
  const found = ids.length
    ? await tx
        .select({ id: accounts.id, currency: accounts.currency, kind: accounts.kind, name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, ids)))
    : [];
  // A pocket parent holds no money: it only adds its pockets up (currency pockets spec §2). This is the one place
  // every entry in the ledger is written, so no screen, import or repository function can get round it.
  const parentOf = ids.length
    ? await tx
        .select({ parentId: accounts.parentId })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset'), inArray(accounts.parentId, ids)))
        .limit(1)
    : [];
  if (parentOf.length > 0) {
    const name = found.find((a) => a.id === parentOf[0]!.parentId)?.name ?? 'That account';
    throw new LedgerError('POCKET_PARENT', `${name} holds no money of its own. Choose one of its pockets.`);
  }
  const planned = planPosting({
    baseCurrency: ws.baseCurrency,
    lines: input.lines,
    ratesToBase: input.ratesToBase ?? {},
    accountCurrencies: Object.fromEntries(found.map((a) => [a.id, a.currency])),
  });

  // A transaction that spends or earns belongs to the book of its categories; one that only moves money between
  // your own accounts (a transfer, a card payment) belongs to none. It may not straddle two books. Computed and
  // checked before any insert below, so a refused posting leaves nothing behind.
  const bookId = (await hasBooks(tx)) ? await bookOfCategories(tx, found) : undefined;

  const id = uuidv7();
  await tx.insert(transactions).values({
    id,
    workspaceId: ws.workspaceId,
    occurredOn: input.occurredOn,
    description: input.description.trim(),
    source: input.source ?? 'manual',
    externalRef: input.externalRef ?? null,
    eventId: input.eventId ?? null,
    status: 'posted',
    replacesTransactionId: input.replacesTransactionId ?? null,
    originalCurrency,
    originalAmountMinor,
    mcc,
    cardId: input.cardId ?? null,
    templateId: input.templateId ?? null,
    createdAt: new Date().toISOString(),
  });
  await tx.insert(entries).values(
    planned.map((p) => ({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      transactionId: id,
      accountId: p.accountId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      fxRateToBase: p.fxRateToBase,
      amountBaseMinor: p.amountBaseMinor,
      memo: p.memo,
      spendCategoryId: p.spendCategoryId,
    })),
  );
  if (bookId) await tx.insert(bookTransactions).values({ transactionId: id, workspaceId: ws.workspaceId, bookId });
  // A payment against a bill says which month's bill it settles, which is not always the month it was paid in.
  if (input.templateId && (await billTablesExist(tx))) {
    const [bill] = await tx
      .select({ id: expenseTemplates.id })
      .from(expenseTemplates)
      .where(and(eq(expenseTemplates.id, input.templateId), eq(expenseTemplates.workspaceId, ws.workspaceId)));
    if (bill) {
      await tx.insert(billPayments).values({
        transactionId: id,
        workspaceId: ws.workspaceId,
        templateId: bill.id,
        billMonth: input.billMonth ?? input.occurredOn.slice(0, 7),
      });
    }
  }
  // What the purchase was, beside what it cost: the channel, the exclusion, and the photos a form wrote before
  // this transaction had an id. Their own tables, so a database stopped before 0048 simply has none of it.
  if (await extrasTablesExist(tx)) await writeExtrasTx(tx, ws, id, input);
  if (input.setAside && (await setAsideTablesExist(tx))) await applySetAsideTx(tx, ws, id, input.occurredOn, planned, input.setAside);
  await audit(tx, ws, 'post', id, input);
  return id;
}

export function postTransaction(database: Database, ws: WorkspaceContext, input: PostTransactionInput): Promise<string> {
  return database.transaction((tx) => postTransactionTx(tx, ws, input));
}

/**
 * Marks one transaction void, with what that means for the money itself: a tagged transfer's arrival and a set-aside
 * answer are taken back, unless `keep` says an edit carries them on (set-aside rulings I1, I2, I4). What else a void
 * means (a deposit event reopened) is `voidTransactionTx`'s; an edit keeps that (`replaceTransaction`).
 */
async function markVoidTx(tx: Db, ws: WorkspaceContext, id: string, keep: VoidKeep = {}): Promise<void> {
  const [row] = await tx
    .select({ status: transactions.status, goalId: transactions.goalId })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
  if (!row) throw new LedgerError('NOT_FOUND', `Transaction ${id} not found`);
  if (row.status === 'void') throw new LedgerError('ALREADY_VOID', `Transaction ${id} is already void`);
  await tx.update(transactions).set({ status: 'void' }).where(eq(transactions.id, id));
  // A transfer tagged to a goal parked what it landed: that comes back out, whichever door deletes or edits it — as far
  // as it is still there. An edit that still moves between the same two accounts keeps it and carries the difference.
  const arrival = row.goalId && !keep.tagged ? await takeBackTaggedArrivalTx(tx, ws, id, row.goalId) : null;
  // What an answer did to a goal is a fact about the same money: it goes when the money goes.
  if (await setAsideTablesExist(tx)) await undoSetAsideTx(tx, ws, id, arrival, keep);
  await audit(tx, ws, 'void', id, {});
}

/** Voids inside an open transaction, so a caller can void and repost several transactions atomically. */
export async function voidTransactionTx(tx: Db, ws: WorkspaceContext, id: string, keep: VoidKeep = {}): Promise<void> {
  await markVoidTx(tx, ws, id, keep);
  // A deposit event this posted is reopened, and the rest of what that event posted is voided with it (whole: `{}`).
  for (const other of await reopenDepositEventTx(tx, ws, id)) {
    const [row] = await tx.select({ status: transactions.status }).from(transactions).where(eq(transactions.id, other));
    if (row?.status === 'posted') await voidTransactionTx(tx, ws, other);
  }
}

export function voidTransaction(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  return database.transaction((tx) => voidTransactionTx(tx, ws, id));
}

/** Edit = void the original and post the replacement atomically. */
export function replaceTransaction(
  database: Database,
  ws: WorkspaceContext,
  id: string,
  input: PostTransactionInput,
): Promise<string> {
  return database.transaction(async (tx) => {
    const [original] = await tx
      .select({
        source: transactions.source,
        externalRef: transactions.externalRef,
        originalCurrency: transactions.originalCurrency,
        originalAmountMinor: transactions.originalAmountMinor,
        mcc: transactions.mcc,
        cardId: transactions.cardId,
        eventId: transactions.eventId,
        templateId: transactions.templateId,
        goalId: transactions.goalId,
      })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
    const [settles] = (await billTablesExist(tx))
      ? await tx.select({ billMonth: billPayments.billMonth }).from(billPayments).where(eq(billPayments.transactionId, id))
      : [];
    // Two workspaces can hold copies of one category, alike on any screen. An edit is a correction to the same
    // spending, so it stays where it was filed: a category from another workspace is refused here, before
    // anything is voided, whatever form or import offered it.
    if (await hasBooks(tx)) {
      const [filed] = await tx
        .select({ bookId: bookTransactions.bookId })
        .from(bookTransactions)
        .where(and(eq(bookTransactions.transactionId, id), eq(bookTransactions.workspaceId, ws.workspaceId)));
      if (filed) {
        const lineIds = [...new Set(input.lines.map((line) => line.accountId))];
        const lineAccounts = lineIds.length
          ? await tx
              .select({ id: accounts.id, kind: accounts.kind })
              .from(accounts)
              .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, lineIds)))
          : [];
        const replacementBook = await bookOfCategories(tx, lineAccounts);
        if (replacementBook && replacementBook !== filed.bookId) {
          throw new LedgerError('OTHER_BOOK', 'That category belongs to another workspace. A transaction stays in the workspace it was filed in.');
        }
      }
    }
    // What the original said about itself, so a correction that does not mention a fact keeps it, and one that
    // mentions it — `channel: null` — clears it. Read before the void, written as part of the replacement.
    const extras = (await extrasTablesExist(tx)) ? await extrasForTx(tx, ws, id) : null;
    // Read before the void. An edit carries the saved answer by the difference, never by undoing and redoing it (rulings
    // I1, I2): an edit that does not mention it (a category re-file), or gives the same one again (an edit form), keeps
    // the draw, re-pointed to the replacement. A different answer, or none, undoes the saved one and applies afresh.
    const tables = await setAsideTablesExist(tx);
    const oldLines = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor })
      .from(entries)
      .where(and(eq(entries.transactionId, id), eq(entries.workspaceId, ws.workspaceId)));
    const saved = tables ? await setAsideChoiceOfTx(tx, ws, id) : null;
    const carried = input.setAside === undefined ? saved : null;
    // A carried answer is dropped when the edit no longer pays from its account (or, a move, into its destination), or
    // its goal was archived since: an edit that does not mention it is never refused over it.
    const answered =
      input.setAside !== undefined ? input.setAside : carried && carryable(carried, input.lines) && (await goalActiveTx(tx, ws, carried.goalId)) ? carried : null;
    const keepAnswer = !!answered && !!saved && sameAnswer(answered, saved) && carryable(answered, input.lines) && (await goalActiveTx(tx, ws, answered.goalId));
    // A transfer tagged to a goal stays tagged when it is corrected. Between the same two accounts it is carried by the
    // difference; to another account, the old one is taken back and the new one parked.
    const [taggedGoal] = original?.goalId
      ? await tx.select({ id: goals.id }).from(goals).where(and(eq(goals.id, original.goalId), eq(goals.workspaceId, ws.workspaceId)))
      : [];
    const nextMove = taggedGoal ? await taggedMoveOfTx(tx, ws, input.occurredOn, input.lines) : null;
    const wasMove = nextMove ? await taggedMoveOfTx(tx, ws, input.occurredOn, oldLines) : null;
    const keepTagged = !!nextMove && !!wasMove && nextMove.fromAccountId === wasMove.fromAccountId && nextMove.toAccountId === wasMove.toAccountId;
    // An edit voids without reopening a deposit event: the replacement carries on what the original was.
    await markVoidTx(tx, ws, id, { answer: keepAnswer, tagged: keepTagged });
    // The same spend answered afresh (from another account) stays on the stage it paid: never the next one.
    const setAside = keepAnswer ? null : withSavedStage(answered, saved);
    // Keep import identity so re-importing the same statement still recognises the row.
    const replacement = await postTransactionTx(tx, ws, {
      ...input,
      source: input.source ?? original?.source,
      externalRef: input.externalRef !== undefined ? input.externalRef : (original?.externalRef ?? null),
      replacesTransactionId: id,
      // Omitting both original fields keeps the original purchase currency; null clears it.
      ...(input.originalCurrency === undefined && input.originalAmountMinor === undefined
        ? { originalCurrency: original?.originalCurrency ?? null, originalAmountMinor: original?.originalAmountMinor ?? null }
        : {}),
      ...(input.mcc === undefined ? { mcc: original?.mcc ?? null } : {}),
      ...(input.cardId === undefined ? { cardId: original?.cardId ?? null } : {}),
      // Correcting a bill payment must not make the bill ask to be paid again.
      ...(input.templateId === undefined ? { templateId: original?.templateId ?? null } : {}),
      // …nor change which month's bill it settled.
      ...(input.billMonth === undefined && settles ? { billMonth: settles.billMonth } : {}),
      ...(input.channel === undefined ? { channel: extras?.channel ?? null } : {}),
      ...(input.excludedFromReport === undefined ? { excludedFromReport: extras?.excluded ?? false } : {}),
      // A correction is still the same spending, so it stays with the event it was tagged to — unless it says otherwise.
      ...(input.eventId === undefined ? { eventId: original?.eventId ?? null } : {}),
      setAside,
    });
    if (keepAnswer) await carryAnswerTx(tx, ws, id, replacement, input.occurredOn, oldLines, input.lines, input.setAside ?? null);
    if (keepTagged) await carryTaggedTx(tx, ws, id, replacement, original!.goalId!, wasMove!, nextMove!);
    else if (nextMove) await parkForGoalTx(tx, ws, replacement, original!.goalId!, nextMove);
    // The date the bank posted it, and the payment made for it (or the purchases a payment was for), are
    // facts about the same money: they follow the correction.
    await tx.update(cardPostings).set({ transactionId: replacement }).where(and(eq(cardPostings.transactionId, id), eq(cardPostings.workspaceId, ws.workspaceId)));
    await tx.update(cardSettlements).set({ purchaseTransactionId: replacement }).where(and(eq(cardSettlements.purchaseTransactionId, id), eq(cardSettlements.workspaceId, ws.workspaceId)));
    await tx.update(cardSettlements).set({ paymentTransactionId: replacement }).where(and(eq(cardSettlements.paymentTransactionId, id), eq(cardSettlements.workspaceId, ws.workspaceId)));
    // Points already checked against the bank follow the edited purchase, flagged so the user can check the edit.
    await tx
      .update(transactionPointActuals)
      .set({ transactionId: replacement, editedAfterCheck: 1 })
      .where(and(eq(transactionPointActuals.transactionId, id), eq(transactionPointActuals.workspaceId, ws.workspaceId)));
    // The pictures follow the correction, as the card postings do: they are rows about the same money.
    if (await extrasTablesExist(tx)) await movePhotosTx(tx, ws, id, replacement);
    // What this payment bought off the plan is a fact about the same money: it follows the correction, and is cut to
    // fit when the correction is smaller.
    await carryEventItemTx(tx, ws, id, replacement);
    // A deposit event it posted stays done, and its log takes the edited figures.
    await followDepositEventTx(tx, ws, id, replacement);
    return replacement;
  });
}

/** Sets or clears a purchase's typed MCC in place: merchant metadata, not amounts, so nothing is reposted. */
export function setTransactionMcc(database: Database, ws: WorkspaceContext, transactionId: string, mcc: string | null): Promise<void> {
  return database.transaction(async (tx) => {
    if (mcc !== null && !isMcc(mcc)) throw new LedgerError('INVALID_MCC', `An MCC is four digits, got "${mcc}"`);
    const [row] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!row) throw new LedgerError('NOT_FOUND', `Transaction ${transactionId} not found`);
    await tx.update(transactions).set({ mcc }).where(eq(transactions.id, transactionId));
    await audit(tx, ws, 'set_mcc', transactionId, { mcc });
  });
}

export interface TransactionEntryView {
  id: string;
  accountId: string;
  accountName: string;
  accountKind: 'asset' | 'liability' | 'income' | 'expense' | 'equity';
  amountMinor: number;
  currency: string;
  fxRateToBase: number;
  amountBaseMinor: number;
  memo: string | null;
  /** Category of a card purchase whose other side is an asset. */
  spendCategoryId: string | null;
}

export interface TransactionView {
  id: string;
  occurredOn: string;
  description: string;
  source: TransactionSource;
  status: 'posted' | 'void';
  externalRef: string | null;
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  mcc: string | null;
  /** The card a purchase was made on, when the account carries more than one. */
  cardId: string | null;
  /** Goal a tagged transfer funds. Ordinary payments never carry one. */
  goalId: string | null;
  /**
   * The event this was tagged to, or null. The column is already what `opts.eventId` filters on; carrying it on
   * the view is what lets a receipt name the trip a purchase belongs to without a second query per row.
   * Optional in the same way `billMonth` is, so a view built by hand in a test need not name it.
   */
  eventId?: string | null;
  /**
   * YYYY-MM: the month's bill a bill payment settles, which can differ from the month it was paid in. Null for
   * anything else, and on a database without bill_payments. Optional so a view built by hand need not name it.
   */
  billMonth?: string | null;
  /**
   * What the purchase was, beside what it cost. Null, false and 0 when nothing was chosen, and on a database
   * without transaction_flags. Optional in the same way billMonth is, so a view built by hand need not name them.
   */
  channel?: 'online' | 'offline' | null;
  excluded?: boolean;
  photoCount?: number;
  createdAt: string;
  entries: TransactionEntryView[];
}

/** The day of the oldest recorded transaction, or null when nothing is recorded: where a year picker starts. */
export async function firstTransactionDate(database: Database, ws: WorkspaceContext): Promise<string | null> {
  const [row] = await database.db
    .select({ first: sql<string | null>`min(${transactions.occurredOn})` })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')));
  return row?.first ?? null;
}

export interface ListTransactionsOptions {
  accountId?: string;
  accountIds?: readonly string[];
  from?: string;
  to?: string;
  includeVoid?: boolean;
  limit?: number;
  eventId?: string;
  /** One transaction by id — what a receipt reads. With `includeVoid`, a deleted one still opens. */
  id?: string;
  /**
   * One book's rows without reading in that book's money: the narrowing `ws.bookId` does, and nothing else.
   *
   * An event spans workspaces, so it is read owner-wide and shown in the owner's own currency; a tab on it asks
   * for one workspace's share of the same trip, which must not also change what currency the figures are in.
   */
  bookId?: string;
}

async function listWith(database: Database, ws: WorkspaceContext, opts: ListTransactionsOptions, money: BookMoney): Promise<TransactionView[]> {
  const conds: SQL[] = [eq(transactions.workspaceId, ws.workspaceId)];
  if (!opts.includeVoid) conds.push(eq(transactions.status, 'posted'));
  // One row by id: what a receipt reads.
  if (opts.id) conds.push(eq(transactions.id, opts.id));
  // An event's own history: what was tagged to it, whenever it happened.
  if (opts.eventId) conds.push(eq(transactions.eventId, opts.eventId));
  if (opts.from) conds.push(gte(transactions.occurredOn, opts.from));
  if (opts.to) conds.push(lte(transactions.occurredOn, opts.to));
  if (opts.accountId) {
    conds.push(sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id = ${opts.accountId})`);
  }
  // A parent category stands for everything under it, so its children are asked for by id as well.
  if (opts.accountIds && opts.accountIds.length > 0) {
    conds.push(sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id IN ${opts.accountIds})`);
  }
  // A book's list: what was filed in it, and what was filed nowhere — moving your own money shows in every book.
  const bookId = opts.bookId ?? ws.bookId;
  if (bookId) {
    conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM book_transactions WHERE book_id <> ${bookId})`);
  }
  const txs = await database.db
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(opts.limit ?? 500);
  if (txs.length === 0) return [];

  const rows = await database.db
    .select({
      id: entries.id,
      transactionId: entries.transactionId,
      accountId: entries.accountId,
      accountName: accounts.name,
      accountKind: accounts.kind,
      amountMinor: entries.amountMinor,
      currency: entries.currency,
      fxRateToBase: entries.fxRateToBase,
      amountBaseMinor: entries.amountBaseMinor,
      memo: entries.memo,
      spendCategoryId: entries.spendCategoryId,
    })
    .from(entries)
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(inArray(entries.transactionId, txs.map((t) => t.id)));

  // Bill months come from their own table, keyed by transaction, so a list without bills pays one small query.
  const billMonths = (await billTablesExist(database.db))
    ? new Map(
        (
          await database.db
            .select({ transactionId: billPayments.transactionId, billMonth: billPayments.billMonth })
            .from(billPayments)
            .where(inArray(billPayments.transactionId, txs.map((t) => t.id)))
        ).map((row) => [row.transactionId, row.billMonth]),
      )
    : new Map<string, string>();

  // The channel, the exclusion and how many pictures were kept: one pair of queries per page, as bill months are.
  const extras = (await extrasTablesExist(database.db)) ? await extrasFor(database.db, ws, txs.map((t) => t.id)) : undefined;

  const byTx = new Map<string, TransactionEntryView[]>();
  for (const { transactionId, ...entry } of rows) {
    const list = byTx.get(transactionId) ?? [];
    list.push(entry);
    byTx.set(transactionId, list);
  }
  const views = txs.map((t) => ({
    id: t.id,
    occurredOn: t.occurredOn,
    description: t.description,
    source: t.source,
    status: t.status,
    externalRef: t.externalRef,
    originalCurrency: t.originalCurrency,
    originalAmountMinor: t.originalAmountMinor,
    mcc: t.mcc,
    cardId: t.cardId,
    goalId: t.goalId,
    eventId: t.eventId,
    billMonth: billMonths.get(t.id) ?? null,
    channel: extras?.get(t.id)?.channel ?? null,
    excluded: extras?.get(t.id)?.excluded ?? false,
    photoCount: extras?.get(t.id)?.photoCount ?? 0,
    createdAt: t.createdAt,
    entries: (byTx.get(t.id) ?? []).sort((a, b) => b.amountMinor - a.amountMinor),
  }));
  // A workspace that reads in another currency reads its list there too: only the base figure the day's total is
  // added up from moves. What was actually paid — the entry's own amount and currency — is left exactly as it was,
  // and an amount no rate reaches counts as nothing rather than as rupiah pretending to be dollars.
  if (money.converts) {
    for (const view of views) {
      for (const entry of view.entries) entry.amountBaseMinor = money.convert(entry.amountMinor, entry.currency, view.occurredOn) ?? 0;
    }
  }
  return views;
}

export async function listTransactions(database: Database, ws: WorkspaceContext, opts: ListTransactionsOptions = {}): Promise<TransactionView[]> {
  return listWith(database, ws, opts, await bookMoneyFor(database, ws));
}

/** The same list, with the currency it reads in and what it could not bring into that currency. */
export async function listTransactionsIn(
  database: Database,
  ws: WorkspaceContext,
  opts: ListTransactionsOptions = {},
): Promise<{ transactions: TransactionView[]; currency: string; missing: Unconverted[] }> {
  const money = await bookMoneyFor(database, ws);
  const rows = await listWith(database, ws, opts, money);
  return { transactions: rows, currency: money.currency, missing: money.missing() };
}

/** Raw debit-positive sums of posted entries per account, in each account's entry currency, up to asOf inclusive. */
export async function nativeBalances(
  database: Database,
  ws: WorkspaceContext,
  asOf?: string,
): Promise<Record<string, number>> {
  const conds: SQL[] = [eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')];
  if (asOf) conds.push(lte(transactions.occurredOn, asOf));
  const rows = await database.db
    .select({ accountId: entries.accountId, total: sql<number>`sum(${entries.amountMinor})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(...conds))
    .groupBy(entries.accountId);
  return Object.fromEntries(rows.map((r) => [r.accountId, Number(r.total)]));
}

/** Posted transactions whose entries do not sum to zero per currency. Should always be empty. */
export async function checkLedgerIntegrity(
  database: Database,
  ws: WorkspaceContext,
): Promise<{ transactionId: string; currency: string; total: number }[]> {
  const rows = await database.db
    .select({ transactionId: entries.transactionId, currency: entries.currency, total: sql<number>`sum(${entries.amountMinor})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')))
    .groupBy(entries.transactionId, entries.currency)
    .having(sql`sum(${entries.amountMinor}) <> 0`);
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}
