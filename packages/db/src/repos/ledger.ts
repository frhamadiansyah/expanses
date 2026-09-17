import { isMcc, isSupportedCurrency, planPosting, type PostingLine, uuidv7 } from '@expanses/core';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, auditLog, entries, transactions } from '../schema';
import { bookTransactions } from '../schema-books';
import { cardPostings, cardSettlements } from '../schema-cards';
import { transactionPointActuals } from '../schema-points';
import { billPayments, expenseTemplates } from '../schema-recurring';
import { BILL_MONTH, billTablesExist } from './bill-months';
import { bookOfCategory, hasBooks } from './books';

export type TransactionSource = 'manual' | 'csv' | 'voice' | 'receipt' | 'email';

export type LedgerErrorCode = 'INVALID_DATE' | 'NOT_FOUND' | 'ALREADY_VOID' | 'INVALID_ORIGINAL' | 'INVALID_MCC' | 'TWO_BOOKS' | 'INVALID_BILL_MONTH';

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
        .select({ id: accounts.id, currency: accounts.currency, kind: accounts.kind })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, ids)))
    : [];
  const planned = planPosting({
    baseCurrency: ws.baseCurrency,
    lines: input.lines,
    ratesToBase: input.ratesToBase ?? {},
    accountCurrencies: Object.fromEntries(found.map((a) => [a.id, a.currency])),
  });

  // A transaction that spends or earns belongs to the book of its categories; one that only moves money between
  // your own accounts (a transfer, a card payment) belongs to none. It may not straddle two books. Computed and
  // checked before any insert below, so a refused posting leaves nothing behind.
  const booksEnabled = await hasBooks(tx);
  let bookId: string | undefined;
  if (booksEnabled) {
    const categoryIds = found.filter((a) => a.kind === 'income' || a.kind === 'expense').map((a) => a.id);
    const bookIds = new Set<string>();
    for (const categoryId of categoryIds) {
      const owner = await bookOfCategory(tx, categoryId);
      if (owner) bookIds.add(owner);
    }
    if (bookIds.size > 1) throw new LedgerError('TWO_BOOKS', 'A transaction cannot spend in two workspaces at once');
    [bookId] = bookIds;
  }

  const id = uuidv7();
  await tx.insert(transactions).values({
    id,
    workspaceId: ws.workspaceId,
    occurredOn: input.occurredOn,
    description: input.description.trim(),
    source: input.source ?? 'manual',
    externalRef: input.externalRef ?? null,
    eventId: null,
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
  await audit(tx, ws, 'post', id, input);
  return id;
}

export function postTransaction(database: Database, ws: WorkspaceContext, input: PostTransactionInput): Promise<string> {
  return database.transaction((tx) => postTransactionTx(tx, ws, input));
}

/** Voids inside an open transaction, so a caller can void and repost several transactions atomically. */
export async function voidTransactionTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  const [row] = await tx
    .select({ status: transactions.status })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
  if (!row) throw new LedgerError('NOT_FOUND', `Transaction ${id} not found`);
  if (row.status === 'void') throw new LedgerError('ALREADY_VOID', `Transaction ${id} is already void`);
  await tx.update(transactions).set({ status: 'void' }).where(eq(transactions.id, id));
  await audit(tx, ws, 'void', id, {});
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
      })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
    const [settles] = (await billTablesExist(tx))
      ? await tx.select({ billMonth: billPayments.billMonth }).from(billPayments).where(eq(billPayments.transactionId, id))
      : [];
    await voidTransactionTx(tx, ws, id);
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
    });
    // A correction is still the same spending, so it stays with the event it was tagged to.
    if (original?.eventId) {
      await tx.update(transactions).set({ eventId: original.eventId }).where(eq(transactions.id, replacement));
    }
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
   * YYYY-MM: the month's bill a bill payment settles, which can differ from the month it was paid in. Null for
   * anything else, and on a database without bill_payments. Optional so a view built by hand need not name it.
   */
  billMonth?: string | null;
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

export async function listTransactions(
  database: Database,
  ws: WorkspaceContext,
  opts: { accountId?: string; accountIds?: readonly string[]; from?: string; to?: string; includeVoid?: boolean; limit?: number; eventId?: string } = {},
): Promise<TransactionView[]> {
  const conds: SQL[] = [eq(transactions.workspaceId, ws.workspaceId)];
  if (!opts.includeVoid) conds.push(eq(transactions.status, 'posted'));
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
  if (ws.bookId) {
    conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM book_transactions WHERE book_id <> ${ws.bookId})`);
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

  const byTx = new Map<string, TransactionEntryView[]>();
  for (const { transactionId, ...entry } of rows) {
    const list = byTx.get(transactionId) ?? [];
    list.push(entry);
    byTx.set(transactionId, list);
  }
  return txs.map((t) => ({
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
    billMonth: billMonths.get(t.id) ?? null,
    createdAt: t.createdAt,
    entries: (byTx.get(t.id) ?? []).sort((a, b) => b.amountMinor - a.amountMinor),
  }));
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
