import { accountDisplayName, BANK_NAMED_SUBTYPES, compareWithinDay, isMcc, isNotCountedKey, isSupportedCurrency, NOT_COUNTED_KEY, NOT_COUNTED_LINE, planDayOrder, planPosting, type PostingLine, uuidv7 } from '@expanses/core';
import { and, desc, eq, getTableColumns, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { accounts, auditLog, entries, transactions } from '../schema';
import { bookTransactions } from '../schema-books';
import { cardPostings, cards, cardSettlements } from '../schema-cards';
import { goals } from '../schema-goals';
import { transactionPointActuals } from '../schema-points';
import { captureCardChangingTx, captureReorderingTx, captureVoidingTx, capturePostedTx, type PaidFrom, splitRefusalTx } from '../sync/capture';
import { billPayments, expenseTemplates } from '../schema-recurring';
import { BILL_MONTH, billTablesExist } from './bill-months';
import { dayOrderExists } from './day-order-column';
import { debitTotal, exactExists, exactFitsPosting, exactForLinesTx, isExactFigure } from './exact-column';
import { type BookMoney, bookMoneyFor, type Unconverted } from './book-currency';
import { bookOfCategory, type BookKind, hasBooks } from './books';
import { bookSplitsExist, excludedLinesTx, lineExclusionsOfMany, splitBooksOfTx, splitHasPartIn, splitPartsOfMany, writeLineExclusionsTx, writeSplitBooksTx } from './book-splits';
import { categoryInBookTx, fileTransferTx, moneyInPartnerTx } from './move-group';
import { carrySharedTransferTx, sharedTransferBooksTx, voidSharedTransferTx } from './shared-transfers';
import { followDepositEventTx, reopenDepositEventTx } from './deposit-event-log';
import { markForeignDirtyTx } from './fx-pending';
import { eventOnlyExists, eventPostingOfTx, notEventOnly } from './event-only';
import { type AccountSubtype, accountBanksTx, ensureSystemAccountTx, SPENDABLE_SUBTYPES, systemAccountId } from './accounts';
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
import { recordActivityTx } from './activity-log';
import { rederiveCardCycles } from './point-ledger';
import { extrasFor, extrasForTx, extrasTablesExist, movePhotosTx, writeExtrasTx } from './transaction-extras';

export type TransactionSource = 'manual' | 'csv' | 'voice' | 'receipt' | 'email' | 'notification' | 'screen' | 'photo';

/** The five channels the ledger's own CHECK knows: what `transactions.source` may actually hold. */
export type LedgerSource = 'manual' | 'csv' | 'voice' | 'receipt' | 'email';

/**
 * The channel a captured row is filed under.
 *
 * A phone captures under notification, screen or photo, and `transactions.source` names a channel — manual, csv, voice,
 * receipt, email — whose CHECK knows none of the three. So a capture is filed under the channel it arrived on: a
 * photographed receipt is a receipt, and a notification or a screenshot is the institution's own message about the
 * payment. The draft keeps the exact source, which is what the queue reads. Widening the ledger's enum needs a rebuild
 * of a table every entry references, which is not a migration for a reader to make.
 */
export function ledgerSourceOf(source: TransactionSource): LedgerSource {
  if (source === 'photo') return 'receipt';
  if (source === 'notification' || source === 'screen') return 'email';
  return source;
}

export type LedgerErrorCode =
  | 'INVALID_DATE'
  | 'NOT_FOUND'
  | 'ALREADY_VOID'
  | 'INVALID_ORIGINAL'
  | 'INVALID_MCC'
  | 'TWO_BOOKS'
  | 'NO_CATEGORY_THERE'
  | 'OTHER_BOOK'
  | 'SPLIT_SHARED'
  | 'SPLIT_MOVE'
  | 'NOT_COUNTED'
  | 'NOT_COUNTED_SHARED'
  | 'INVALID_BILL_MONTH'
  | 'POCKET_PARENT'
  | 'OTHER_DAY'
  | 'INVALID_EXACT'
  | 'EVENT_POSTING'
  | 'FUND_SWITCH'
  | 'ASSET_SALE'
  | 'NOT_A_CARD_PURCHASE'
  | 'NOT_A_MONEY_PURCHASE'
  | 'CARD_NOT_FOUND'
  | 'NOT_ON_CARD';

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
  /**
   * A credit card purchase from before the card started in the app, already paid off: it is posted, and beside it a
   * settlement against Opening Balances on the same day, so what the card owes today does not change and no bank
   * account moves. The settlement follows the purchase when it is edited, and goes with it when it is deleted.
   */
  settledBeforeApp?: boolean;
  /**
   * An expense or income on a money account (a wallet, a bank, a saving account, cash) from before the account's
   * balance was counted: it is posted, and beside it a balancing pair against Before the app on the same day, so the
   * account's balance — today's and on any past day — does not change, while the purchase still counts in reports,
   * categories and budgets by its date. The same mark and the same balancing row as `settledBeforeApp`, which a credit
   * card keeps; a transfer, or a purchase on no money account, ignores it. On `replaceTransaction`, as `settledBeforeApp`.
   */
  pastPurchase?: boolean;
  /**
   * On `replaceTransaction`: the correction moves the transaction to the workspace its categories are in. Without it a
   * category from another workspace is refused, since an ordinary edit stays where it was filed. Never read by a post.
   */
  moveToBook?: boolean;
  /**
   * On `replaceTransaction`, with `moveToBook`: the workspace it moves to. A transfer has no category to say it, so this
   * files the replacement there (a bare transfer then shows in that workspace only; left unfiled when the workspace is
   * shared), and a withdrawal's or top-up's other half — its transfer, or its fee — moves with it in the same database
   * transaction, wherever each half was filed. Moving a group that is already split reunites it.
   */
  toBookId?: string;
  /**
   * A transfer between the owner's own accounts that is recorded in the open workspace: it is filed there, so it shows in
   * that workspace's lists and in no other's. Ignored when the posting has a category (that files it), when the open
   * workspace is shared with a household, and on `replaceTransaction` (an edit keeps how the original was filed: one from
   * before transfers were filed stays in every workspace until it is moved).
   */
  fileTransfer?: boolean;
  /**
   * Its category lines may come from several workspaces: one purchase split across workspaces (0084), each workspace
   * counting its own part. Without it, categories from two workspaces are refused (TWO_BOOKS), which is what a form
   * that mixed them by accident needs. The Split sheet asks for it. On `replaceTransaction`, undefined carries the
   * original's: an edit of a split across workspaces may stay one.
   */
  acrossBooks?: boolean;
  /**
   * The lines left out of their workspace's reports (0090, 0096) — the chart, the budgets, the category totals,
   * Financial health, an event's spending — each named by its category, so a form that knows its rows and not their
   * workspaces can say it. Each line is its own: naming Groceries leaves Gift (in the same workspace) counted. All the
   * lines of a workspace named is that workspace's part excluded (a split's part flag, or `excludedFromReport` on a
   * purchase in one workspace), which is how an older build reads it. The card keeps the whole charge either way. On
   * `replaceTransaction`, undefined carries the original's lines, by category.
   */
  excludedParts?: readonly string[] | null;
  /**
   * Its place within its day, when moved there by hand (0067). A new posting leaves it null, so it lands on top of its
   * day. On `replaceTransaction`, undefined carries the original's while the date stays the same and clears it when the
   * date changes; a value (sync's apply) is written as given.
   */
  dayOrder?: number | null;
  /**
   * The amount as typed with cents, in a currency with no minor unit (0068): 12.500,30 is 1250030, in hundredths of
   * the currency unit, always positive. It is in the lines' own currency, the one charged — never `originalCurrency`,
   * the purchase's currency before the issuer converted it. The lines carry the whole figure (12.501 for money out,
   * 12.500 for money in): the posting must have exactly one expense or income line, and it must be this figure rounded,
   * else INVALID_EXACT. Null or absent when the amount was whole; a figure whose cents are
   * zero is stored as null. On `replaceTransaction`, undefined carries the original's while the edit moves the same
   * money (its debit lines add up to what they did) and clears it when the amount changes; a value, or null, is
   * written as given.
   */
  exactHundredths?: number | null;
  /** Photo rows written before the transaction had an id. */
  photoIds?: string[];
  /**
   * Which goal the money came out of, when it took more than was free (spec §4.4). Applied inside this posting;
   * undefined on `replaceTransaction` means "carry the original's", null means none.
   */
  setAside?: SetAsideChoice | null;
  /**
   * The row's id, when the caller must choose it: only household sharing's apply, posting a purchase's first row under
   * its lineage id (spec §7.2). Everyone else lets the ledger mint one. `replaceTransaction` never passes it on.
   */
  id?: string;
  /** The member whose change this posting applies (spec §7.3): lands in the audit 'post' payload, as all input does. */
  syncAuthor?: string;
  /**
   * Joint net worth §5.3, a sync-only hint like `syncAuthor`: the group member's shared item this purchase is paid from
   * (Paid with, §7.1), its money side posted on that member's placeholder (`paidFromAccount`). Read by capture alone,
   * never stored on the row: the purchase's lineage keeps it. Undefined means "as the lineage already says"; null, none.
   */
  paidFrom?: PaidFrom | null;
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
 * The books a posting belongs to: the one its income and expense lines are filed in, or none when it has no
 * category lines at all. Refuses a posting whose categories come from two books, unless it is split across them
 * (`acrossBooks`): then every book a line is filed in, in the order the lines name them.
 */
async function booksOfCategories(tx: Db, lineAccounts: readonly { id: string; kind: string }[], acrossBooks = false): Promise<string[]> {
  const bookIds = new Set<string>();
  for (const account of lineAccounts) {
    if (account.kind !== 'income' && account.kind !== 'expense') continue;
    const owner = await bookOfCategory(tx, account.id);
    if (owner) bookIds.add(owner);
  }
  // "Spend" would be wrong for the income and refund sides this also guards, and for a form that mixed the
  // two by accident the fix is the same: pick the categories from one workspace.
  if (bookIds.size > 1 && !acrossBooks) throw new LedgerError('TWO_BOOKS', 'A transaction cannot belong to two workspaces at once. Pick categories from one workspace.');
  return [...bookIds];
}

/**
 * A purchase split across workspaces may be filed: the table is there (0084), and household sharing can carry it — at
 * most one of its workspaces shared, where it travels as its part there, paid from this member's own money
 * (`splitRefusalTx`).
 */
async function refuseSplitTx(tx: Db, bookIds: readonly string[], lineAccounts: readonly { id: string; kind: string }[], replacesTransactionId: string | null): Promise<void> {
  if (!(await bookSplitsExist(tx))) throw new LedgerError('TWO_BOOKS', 'A transaction cannot belong to two workspaces at once. Pick categories from one workspace.');
  const money = lineAccounts.filter((account) => account.kind !== 'income' && account.kind !== 'expense').map((account) => account.id);
  const why = await splitRefusalTx(tx, bookIds, money, replacesTransactionId);
  if (why) throw new LedgerError('SPLIT_SHARED', why);
}

/** The workspaces a saved transaction is filed in: its one book, each book of a split, or none (a transfer). */
async function filedBooksTx(tx: Db, ws: WorkspaceContext, id: string): Promise<string[]> {
  const [filed] = await tx
    .select({ bookId: bookTransactions.bookId })
    .from(bookTransactions)
    .where(and(eq(bookTransactions.transactionId, id), eq(bookTransactions.workspaceId, ws.workspaceId)));
  return filed ? [filed.bookId] : splitBooksOfTx(tx, id);
}

/**
 * The card a purchase that names none was made with, when there is no question which: a purchase spent under a category
 * and charged to one credit-card account, which has exactly one card in use. Paid with offers such an account as one row
 * naming no card, so every way in — the Add screen, a table row, a capture, a statement row, an import, a shared bill —
 * leaves the card to this. An account with no card names none; one with two or more leaves the card for the owner to say.
 */
async function onlyCardOfPurchaseTx(tx: Db, ws: WorkspaceContext, found: readonly { id: string; kind: string; subtype: string }[]): Promise<string | null> {
  if (!found.some((account) => account.kind === 'expense')) return null;
  const onCard = found.filter((account) => account.subtype === 'credit_card');
  if (onCard.length !== 1) return null;
  // Cards came with 0034: a database stopped before it has none to name.
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'`)).length === 0) return null;
  const inUse = await tx.values<[string]>(
    sql`SELECT id FROM cards WHERE workspace_id = ${ws.workspaceId} AND account_id = ${onCard[0]!.id} AND archived_at IS NULL LIMIT 2`,
  );
  return inUse.length === 1 ? inUse[0]![0] : null;
}

// A split part counted in no workspace ("Not counted"): `NOT_COUNTED_LINE` names its line, posted on the workspace's
// Not counted equity account (`NOT_COUNTED_KEY`). Re-exported for the callers that build postings from this package.
export { isNotCountedKey, NOT_COUNTED_KEY, NOT_COUNTED_LINE };

/** The posting with every `NOT_COUNTED_LINE` on the Not counted account. Untouched (the same object) when none is. */
async function withNotCountedTx(tx: Db, ws: WorkspaceContext, input: PostTransactionInput): Promise<PostTransactionInput> {
  if (!input.lines.some((line) => line.accountId === NOT_COUNTED_LINE)) return input;
  const id = await ensureSystemAccountTx(tx, ws, NOT_COUNTED_KEY);
  return { ...input, lines: input.lines.map((line) => (line.accountId === NOT_COUNTED_LINE ? { ...line, accountId: id } : line)) };
}

/**
 * A posting with a Not counted part, checked: the part is money spent (more than nothing), beside at least one part
 * in a workspace — a purchase none of which counts anywhere is one excluded from report whole — and not in a purchase
 * with a part in a shared workspace. A shared workspace's purchase travels to the other members as its part there with
 * the money that paid for it; a part that belongs to no workspace has nowhere to travel and no workspace to stay in,
 * which is what refusing it keeps true (the share is refused the same way: `assertShareableTx`).
 */
async function refuseNotCountedTx(
  tx: Db,
  found: readonly { id: string; kind: string; systemKey: string | null }[],
  lines: readonly PostingLine[],
  bookIds: readonly string[],
): Promise<void> {
  const notCounted = new Set(found.filter((account) => account.kind === 'equity' && isNotCountedKey(account.systemKey)).map((account) => account.id));
  if (notCounted.size === 0) return;
  if (lines.some((line) => notCounted.has(line.accountId) && line.amountMinor <= 0)) {
    throw new LedgerError('NOT_COUNTED', 'A part that is not counted is money spent: give it an amount.');
  }
  const kindOf = new Map(found.map((account) => [account.id, account.kind]));
  if (!lines.some((line) => kindOf.get(line.accountId) === 'expense')) {
    throw new LedgerError('NOT_COUNTED', 'A split needs at least one part in a workspace. To leave the whole purchase out, switch on Exclude from report.');
  }
  if (bookIds.length > 0 && (await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length > 0) {
    if ((await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id IN ${[...bookIds]} LIMIT 1`)).length > 0) {
      throw new LedgerError(
        'NOT_COUNTED_SHARED',
        'A purchase with a part in a shared workspace keeps every part in a workspace. Put that part in a workspace that is not shared and switch on its Exclude from report.',
      );
    }
  }
}

/** Posts inside an open transaction. Throws PostingError or LedgerError without writing on invalid input. */
export async function postTransactionTx(tx: Db, ws: WorkspaceContext, given: PostTransactionInput): Promise<string> {
  const input = await withNotCountedTx(tx, ws, given);
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
  const exact = input.exactHundredths ?? null;
  if (exact !== null && !isExactFigure(exact)) {
    throw new LedgerError('INVALID_EXACT', `An exact amount is a positive whole number of hundredths, got ${exact}`);
  }
  const ids = [...new Set(input.lines.map((l) => l.accountId))];
  const found = ids.length
    ? await tx
        .select({ id: accounts.id, currency: accounts.currency, kind: accounts.kind, name: accounts.name, subtype: accounts.subtype, systemKey: accounts.systemKey })
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
  // A figure typed with cents goes on a single amount: one expense or income line, which is that figure rounded.
  if (exact !== null) {
    const kindOf = new Map(found.map((a) => [a.id, a.kind]));
    if (!exactFitsPosting(input.lines.map((line) => ({ amountMinor: line.amountMinor, kind: kindOf.get(line.accountId) ?? '' })), exact)) {
      throw new LedgerError('INVALID_EXACT', `A figure with cents goes on a single expense or income amount rounded from it (${exact / 100})`);
    }
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
  // Split across workspaces, it belongs to each book it has a part in instead (0084).
  const bookIds = (await hasBooks(tx)) ? await booksOfCategories(tx, found, input.acrossBooks) : [];
  if (bookIds.length > 1) await refuseSplitTx(tx, bookIds, found, input.replacesTransactionId ?? null);
  await refuseNotCountedTx(tx, found, input.lines, bookIds);
  const bookId = bookIds.length === 1 ? bookIds[0] : undefined;
  // Which lines are left out of their workspace's reports (0090, 0096): each line says it for itself, named by its
  // category, and "the whole purchase" is every line. A workspace whose every line is out is written the way 0090
  // wrote it — a split's part flag, a single workspace's purchase flag — so an older build reads it as it always did;
  // a line out beside lines that count is a row of its own.
  const categoryIds = new Set(found.filter((account) => account.kind === 'expense' || account.kind === 'income').map((account) => account.id));
  const named = new Set((input.excludedParts ?? []).filter((id) => categoryIds.has(id)));
  const off = input.excludedFromReport ? new Set(categoryIds) : named;
  const excludedBooks = new Set<string>();
  let excludedWhole = false;
  const lineRows = new Set<string>();
  if (bookIds.length > 1) {
    // Split across workspaces: the purchase's own flag stays off; a part is out when every line of it is.
    const linesOf = new Map<string, string[]>();
    for (const categoryId of categoryIds) {
      const filedIn = await bookOfCategory(tx, categoryId);
      if (filedIn && bookIds.includes(filedIn)) linesOf.set(filedIn, [...(linesOf.get(filedIn) ?? []), categoryId]);
    }
    for (const [filedIn, list] of linesOf) {
      if (list.every((categoryId) => off.has(categoryId))) excludedBooks.add(filedIn);
      else for (const categoryId of list) if (off.has(categoryId)) lineRows.add(categoryId);
    }
  } else {
    excludedWhole = Boolean(input.excludedFromReport) || (categoryIds.size > 0 && [...categoryIds].every((categoryId) => off.has(categoryId)));
    if (!excludedWhole) for (const categoryId of off) lineRows.add(categoryId);
  }

  const id = input.id ?? uuidv7();
  await tx.insert(transactions).values({
    id,
    workspaceId: ws.workspaceId,
    occurredOn: input.occurredOn,
    description: input.description.trim(),
    source: ledgerSourceOf(input.source ?? 'manual'),
    externalRef: input.externalRef ?? null,
    eventId: input.eventId ?? null,
    status: 'posted',
    replacesTransactionId: input.replacesTransactionId ?? null,
    originalCurrency,
    originalAmountMinor,
    mcc,
    cardId: input.cardId ?? (await onlyCardOfPurchaseTx(tx, ws, found)),
    templateId: input.templateId ?? null,
    createdAt: new Date().toISOString(),
  });
  // Unplaced unless told (an edit on the same day, or a shared purchase's place arriving): see day-order-column.ts.
  if (input.dayOrder !== undefined && input.dayOrder !== null && (await dayOrderExists(tx))) {
    await tx.run(sql`UPDATE transactions SET day_order = ${input.dayOrder} WHERE id = ${id}`);
  }
  // The figure typed with cents, kept beside the whole one (see exact-column.ts); a whole figure keeps nothing.
  if (exact !== null && exact % 100 !== 0 && (await exactExists(tx))) {
    await tx.run(sql`UPDATE transactions SET exact_hundredths = ${exact} WHERE id = ${id}`);
  }
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
  else if (bookIds.length === 0 && input.fileTransfer && ws.bookId && (await hasBooks(tx)) && !input.replacesTransactionId) await fileTransferTx(tx, ws, id, ws.bookId);
  else if (bookIds.length > 1) await writeSplitBooksTx(tx, ws.workspaceId, id, bookIds, excludedBooks);
  if (lineRows.size > 0) await writeLineExclusionsTx(tx, ws.workspaceId, id, lineRows);
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
  if (await extrasTablesExist(tx)) await writeExtrasTx(tx, ws, id, { ...input, excludedFromReport: excludedWhole });
  if (input.setAside && (await setAsideTablesExist(tx))) await applySetAsideTx(tx, ws, id, input.occurredOn, planned, input.setAside);
  // Withdrawal rate §6: a foreign money account this touches is recalculated at the end of the db transaction, from
  // this date — before capture reads the figures, so a shared purchase goes out at the withdrawal rate (R9). Every
  // posting comes through here: a form, an import, a statement check, a conversion, a trade, a debt, a goal transfer,
  // a shared event's derivation and sync apply alike.
  await markForeignDirtyTx(tx, ws, id);
  // Household sharing: the lineage this row joins, resolved by its net effect before the transaction commits (§6.3).
  await capturePostedTx(tx, id, bookId ?? null, input.replacesTransactionId ?? null, input.paidFrom);
  await audit(tx, ws, 'post', id, input);
  if (input.settledBeforeApp || input.pastPurchase) await settleBeforeAppTx(tx, ws, id, input);
  return id;
}

/** The settlement that keeps a card even beside a purchase paid off before the app: found by the purchase's id. */
const beforeAppRef = (purchaseId: string) => `before-app:${purchaseId}`;

/** The credit card line of a purchase's postings: what the card took on, and in which currency. Null when none. */
async function cardLineOf(tx: Db, ws: WorkspaceContext, lines: readonly PostingLine[]): Promise<PostingLine | null> {
  for (const line of lines) {
    const [account] = await tx.select({ kind: accounts.kind, subtype: accounts.subtype }).from(accounts).where(and(eq(accounts.id, line.accountId), eq(accounts.workspaceId, ws.workspaceId)));
    // A purchase takes the card down, money back brings it up: either is settled by its mirror.
    if (account?.kind === 'liability' && account.subtype === 'credit_card' && line.amountMinor !== 0) return line;
  }
  return null;
}

/**
 * The money-account lines of an expense or income, the ones a past purchase (`pastPurchase`) balances. Empty unless the
 * postings include a spending or income category line (a transfer between accounts has none and is never past).
 */
async function moneyLinesOf(tx: Db, ws: WorkspaceContext, lines: readonly PostingLine[]): Promise<PostingLine[]> {
  const found = new Map<string, { kind: string; subtype: string }>();
  for (const line of lines) {
    if (found.has(line.accountId)) continue;
    const [account] = await tx.select({ kind: accounts.kind, subtype: accounts.subtype }).from(accounts).where(and(eq(accounts.id, line.accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (account) found.set(line.accountId, account);
  }
  if (!lines.some((line) => ['expense', 'income'].includes(found.get(line.accountId)?.kind ?? ''))) return [];
  return lines.filter((line) => {
    const account = found.get(line.accountId);
    return account?.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype as AccountSubtype) && line.amountMinor !== 0;
  });
}

/**
 * The settlement's postings. A credit card is paid back what it took on, against Opening Balances. A purchase on a
 * money account is balanced the same way against Before the app: each money line is reversed in its own currency, so
 * the account ends where it started and the pair sums to zero per currency. Null when there is nothing to balance.
 */
async function settlementInputOf(tx: Db, ws: WorkspaceContext, purchaseId: string, input: PostTransactionInput): Promise<PostTransactionInput | null> {
  const card = await cardLineOf(tx, ws, input.lines);
  if (card) {
    const opening = await systemAccountId(tx, ws, 'opening_balance');
    return {
      occurredOn: input.occurredOn,
      description: 'Settled before the app',
      lines: [
        { accountId: card.accountId, amountMinor: -card.amountMinor, currency: card.currency },
        { accountId: opening, amountMinor: card.amountMinor, currency: card.currency },
      ],
      ratesToBase: input.ratesToBase,
      externalRef: beforeAppRef(purchaseId),
    };
  }
  const money = await moneyLinesOf(tx, ws, input.lines);
  if (money.length === 0) return null;
  const before = await ensureSystemAccountTx(tx, ws, 'before_the_app');
  const counter = new Map<string, number>();
  for (const line of money) counter.set(line.currency, (counter.get(line.currency) ?? 0) + line.amountMinor);
  return {
    occurredOn: input.occurredOn,
    description: 'Settled before the app',
    lines: [
      ...money.map((line) => ({ accountId: line.accountId, amountMinor: -line.amountMinor, currency: line.currency })),
      ...[...counter].filter(([, minor]) => minor !== 0).map(([currency, minor]) => ({ accountId: before, amountMinor: minor, currency })),
    ],
    ratesToBase: input.ratesToBase,
    externalRef: beforeAppRef(purchaseId),
  };
}

async function settleBeforeAppTx(tx: Db, ws: WorkspaceContext, purchaseId: string, input: PostTransactionInput): Promise<void> {
  const settlement = await settlementInputOf(tx, ws, purchaseId, input);
  if (settlement) await postTransactionTx(tx, ws, settlement);
}

/** The posted settlement of a purchase paid off before the app, when it has one. */
async function settlementOfTx(tx: Db, ws: WorkspaceContext, purchaseId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, ws.workspaceId), eq(transactions.externalRef, beforeAppRef(purchaseId)), eq(transactions.status, 'posted')));
  return row?.id ?? null;
}

/** Whether a purchase was recorded as already paid off: it has a settlement beside it. */
export async function settledBeforeAppOf(database: Database, ws: WorkspaceContext, purchaseId: string): Promise<boolean> {
  return (await settlementOfTx(database.db, ws, purchaseId)) !== null;
}

/**
 * Marks a saved card purchase paid off before the app, or takes that back, without touching the purchase itself:
 * the card's statement does this once the purchase's bill has closed. Asking for what already stands does nothing.
 */
export function setSettledBeforeApp(database: Database, ws: WorkspaceContext, purchaseId: string, settled: boolean): Promise<void> {
  return database.transaction(async (tx) => {
    const [purchase] = await tx
      .select({ occurredOn: transactions.occurredOn, status: transactions.status })
      .from(transactions)
      .where(and(eq(transactions.id, purchaseId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!purchase || purchase.status !== 'posted') throw new LedgerError('NOT_FOUND', `Transaction ${purchaseId} not found`);
    const settlement = await settlementOfTx(tx, ws, purchaseId);
    if (!settled) {
      if (settlement) await voidTransactionTx(tx, ws, settlement);
      return;
    }
    if (settlement) return;
    const rows = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, rate: entries.fxRateToBase })
      .from(entries)
      .where(and(eq(entries.transactionId, purchaseId), eq(entries.workspaceId, ws.workspaceId)));
    const input: PostTransactionInput = {
      occurredOn: purchase.occurredOn,
      description: '',
      lines: rows.map(({ accountId, amountMinor, currency }) => ({ accountId, amountMinor, currency })),
      ratesToBase: Object.fromEntries(rows.map((row) => [row.currency, row.rate])),
    };
    if (!(await cardLineOf(tx, ws, input.lines))) throw new LedgerError('NOT_A_CARD_PURCHASE', 'Only a credit card purchase can be paid off before the app');
    await settleBeforeAppTx(tx, ws, purchaseId, input);
  });
}

/**
 * Whether a purchase dated `occurredOn` starts out as a past purchase on an account whose balance is counted from
 * `accountOpenedOn`: strictly before it, yes; on or after, no. An account with no opening day has no default. Only a
 * default — each purchase carries its own mark, and moving the account's day later never rewrites an old one.
 */
export function isPastDefault(accountOpenedOn: string | null | undefined, occurredOn: string): boolean {
  return !!accountOpenedOn && occurredOn < accountOpenedOn;
}

/** Whether a purchase on a money account carries the past mark: the same balancing row `settledBeforeAppOf` finds. */
export const pastPurchaseOf = settledBeforeAppOf;

/**
 * Marks a saved expense or income on a money account as a past purchase, or takes that back, without touching the
 * purchase itself: the balance moves by the amount, once. Asking for what already stands does nothing. Refused for a
 * transfer or anything not on a money account.
 */
export function setPastPurchase(database: Database, ws: WorkspaceContext, purchaseId: string, past: boolean): Promise<void> {
  return database.transaction(async (tx) => {
    const [purchase] = await tx
      .select({ occurredOn: transactions.occurredOn, status: transactions.status })
      .from(transactions)
      .where(and(eq(transactions.id, purchaseId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!purchase || purchase.status !== 'posted') throw new LedgerError('NOT_FOUND', `Transaction ${purchaseId} not found`);
    const settlement = await settlementOfTx(tx, ws, purchaseId);
    if (!past) {
      if (settlement) await voidTransactionTx(tx, ws, settlement);
      return;
    }
    if (settlement) return;
    const rows = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, rate: entries.fxRateToBase })
      .from(entries)
      .where(and(eq(entries.transactionId, purchaseId), eq(entries.workspaceId, ws.workspaceId)));
    const input: PostTransactionInput = {
      occurredOn: purchase.occurredOn,
      description: '',
      lines: rows.map(({ accountId, amountMinor, currency }) => ({ accountId, amountMinor, currency })),
      ratesToBase: Object.fromEntries(rows.map((row) => [row.currency, row.rate])),
    };
    if ((await moneyLinesOf(tx, ws, input.lines)).length === 0 || (await cardLineOf(tx, ws, input.lines))) {
      throw new LedgerError('NOT_A_MONEY_PURCHASE', 'Only an expense or income on a money account can be a past purchase');
    }
    await settleBeforeAppTx(tx, ws, purchaseId, input);
  });
}

export async function postTransaction(database: Database, ws: WorkspaceContext, input: PostTransactionInput): Promise<string> {
  const id = await database.transaction(async (tx) => {
    const id = await postTransactionTx(tx, ws, input);
    // The plain door is the one a person uses; a post that corrects another row is an edit, written by `replaceTransaction`.
    if (!input.replacesTransactionId) await recordActivityTx(tx, ws, 'create', id);
    return id;
  });
  await rederiveCardCycles(database, ws, input.lines.map((line) => line.accountId), [input.occurredOn]);
  return id;
}

/**
 * Several plain purchases posted in one database transaction: all of them are written or none, so a list pasted in one go
 * never half-lands. Each gets the activity entry `postTransaction` writes; the card cycles they touch are re-derived once,
 * after. Returns the new ids in the order given.
 */
export async function postTransactions(database: Database, ws: WorkspaceContext, inputs: readonly PostTransactionInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];
  const ids = await database.transaction(async (tx) => {
    const made: string[] = [];
    for (const input of inputs) {
      const id = await postTransactionTx(tx, ws, input);
      if (!input.replacesTransactionId) await recordActivityTx(tx, ws, 'create', id);
      made.push(id);
    }
    return made;
  });
  await rederiveCardCycles(
    database,
    ws,
    [...new Set(inputs.flatMap((input) => input.lines.map((line) => line.accountId)))],
    [...new Set(inputs.map((input) => input.occurredOn))],
  );
  return ids;
}

/** The day and accounts of a transaction before it is voided or replaced, for the cards whose cycles it touched. */
async function factsOf(database: Database, ws: WorkspaceContext, id: string): Promise<{ on: string | null; accountIds: string[] }> {
  try {
    const [row] = await database.db.select({ on: transactions.occurredOn }).from(transactions).where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
    const lines = await database.db.select({ accountId: entries.accountId }).from(entries).where(eq(entries.transactionId, id));
    return { on: row?.on ?? null, accountIds: lines.map((line) => line.accountId) };
  } catch {
    return { on: null, accountIds: [] };
  }
}

/**
 * Marks one transaction void, with what that means for the money itself: a tagged transfer's arrival and a set-aside
 * answer are taken back, unless `keep` says an edit carries them on (set-aside rulings I1, I2, I4). What else a void
 * means (a deposit event reopened) is `voidTransactionTx`'s; an edit keeps that (`replaceTransaction`).
 */
async function markVoidTx(tx: Db, ws: WorkspaceContext, id: string, keep: VoidKeep = {}, author?: string, door: LedgerDoor = {}): Promise<void> {
  if (!door.eventDerivation) await refuseEventPostingTx(tx, id);
  if (!door.fundSwitch) await guardFundSwitchTx(tx, ws, id, author);
  if (!door.assetSale) await guardAssetSaleTx(tx, ws, id);
  const [row] = await tx
    .select({ status: transactions.status, goalId: transactions.goalId })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
  if (!row) throw new LedgerError('NOT_FOUND', `Transaction ${id} not found`);
  if (row.status === 'void') throw new LedgerError('ALREADY_VOID', `Transaction ${id} is already void`);
  // Household sharing: read the lineage before its head changes; the flush decides whether this is a void or a
  // correction (a replace posts the next head in the same transaction).
  await captureVoidingTx(tx, id);
  if (!door.keepSharedTransfer) await voidSharedTransferTx(tx, id);
  await tx.update(transactions).set({ status: 'void' }).where(eq(transactions.id, id));
  // What this took out of (or put into) a foreign account is no longer there: its later outflows are recalculated (§6).
  // Every void and every replace's void comes through here, the event's derivation and an account's deletion included.
  await markForeignDirtyTx(tx, ws, id);
  // A transfer tagged to a goal parked what it landed: that comes back out, whichever door deletes or edits it — as far
  // as it is still there. An edit that still moves between the same two accounts keeps it and carries the difference.
  const arrival = row.goalId && !keep.tagged ? await takeBackTaggedArrivalTx(tx, ws, id, row.goalId) : null;
  // What an answer did to a goal is a fact about the same money: it goes when the money goes.
  if (await setAsideTablesExist(tx)) await undoSetAsideTx(tx, ws, id, arrival, keep);
  await audit(tx, ws, 'void', id, author ? { syncAuthor: author } : {});
}

/**
 * Voids inside an open transaction, so a caller can void and repost several transactions atomically. `author` is the
 * member whose change this applies (household sharing, spec §7.3), recorded in the audit 'void' payload.
 */
export async function voidTransactionTx(tx: Db, ws: WorkspaceContext, id: string, keep: VoidKeep = {}, author?: string, door: LedgerDoor = {}): Promise<void> {
  await markVoidTx(tx, ws, id, keep, author, door);
  // A purchase paid off before the app takes its settlement with it: left behind, it would lower what the card owes.
  const settlement = await settlementOfTx(tx, ws, id);
  if (settlement) await voidTransactionTx(tx, ws, settlement, {}, author);
  // A deposit event this posted is reopened, and the rest of what that event posted is voided with it (whole: `{}`).
  for (const other of await reopenDepositEventTx(tx, ws, id)) {
    const [row] = await tx.select({ status: transactions.status }).from(transactions).where(eq(transactions.id, other));
    if (row?.status === 'posted') await voidTransactionTx(tx, ws, other, {}, author);
  }
}

/**
 * Erases void transactions for good, with their lines: the one door that deletes ledger rows (sharing resilience §5,
 * `eraseBookTx`). `ids` selects the candidates; only rows already void go, so no balance or figure changes here — the
 * void before it marked whatever needed working out again. The caller has taken every other row that names them.
 * Returns how many went.
 */
export async function eraseVoidTransactionsTx(tx: Db, ws: WorkspaceContext, ids: SQL): Promise<number> {
  const gone = sql`SELECT id FROM transactions WHERE workspace_id = ${ws.workspaceId} AND status <> 'posted' AND id IN (${ids})`;
  await tx.run(sql`DELETE FROM entries WHERE transaction_id IN (${gone})`);
  const rows = await tx.values<[string]>(sql`DELETE FROM transactions WHERE id IN (${gone}) RETURNING id`);
  return rows.length;
}

/**
 * Re-files a transaction from one workspace into another IN PLACE, keeping its id (sharing resilience §5, fix round 2):
 * for a trade's or a sale's transaction in a read-only joined copy being deleted, whose id the trade or sale record
 * needs. Only which categories its lines name changes — each category line, and each line's spending category, of
 * `fromBookId` swapped by `swap` — and its filing row; every amount, money account, rate and date stays, so no balance,
 * holding or foreign-currency figure moves. Plain writes with no capture: the caller has capture suspended.
 */
export async function refileInPlaceTx(tx: Db, ws: WorkspaceContext, id: string, fromBookId: string, toBookId: string, swap: (categoryId: string) => Promise<string>): Promise<void> {
  const inFrom = sql`SELECT category_account_id FROM book_categories WHERE book_id = ${fromBookId}`;
  const lines = await tx.values<[string, string, string | null]>(sql`
    SELECT id, account_id, spend_category_id FROM entries WHERE transaction_id = ${id} AND workspace_id = ${ws.workspaceId}
      AND (account_id IN (${inFrom}) OR spend_category_id IN (${inFrom}))`);
  const swapped = new Map<string, string>();
  const to = async (categoryId: string) => swapped.get(categoryId) ?? swapped.set(categoryId, await swap(categoryId)).get(categoryId)!;
  const inBookFrom = new Set((await tx.values<[string]>(inFrom)).map(([c]) => c));
  for (const [entryId, accountId, spendCategoryId] of lines) {
    const account = inBookFrom.has(accountId) ? await to(accountId) : accountId;
    const spend = spendCategoryId && inBookFrom.has(spendCategoryId) ? await to(spendCategoryId) : spendCategoryId;
    await tx.run(sql`UPDATE entries SET account_id = ${account}, spend_category_id = ${spend} WHERE id = ${entryId}`);
  }
  const excludes = (await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transaction_line_excluded'`)).length > 0;
  // Two of the copy's categories can map to one there: their exclusions become one row, never a second one (its key).
  for (const [from, there] of excludes ? swapped : new Map<string, string>()) {
    await tx.run(sql`UPDATE OR IGNORE transaction_line_excluded SET account_id = ${there} WHERE transaction_id = ${id} AND account_id = ${from}`);
    await tx.run(sql`DELETE FROM transaction_line_excluded WHERE transaction_id = ${id} AND account_id = ${from}`);
  }
  await tx.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${id} AND book_id = ${fromBookId}`);
  if (await bookSplitsExist(tx)) await tx.run(sql`DELETE FROM book_transaction_splits WHERE transaction_id = ${id} AND book_id = ${fromBookId}`);
  const [filed] = await tx.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${id}`);
  if (!filed) await tx.insert(bookTransactions).values({ transactionId: id, workspaceId: ws.workspaceId, bookId: toBookId });
}

/**
 * Gives a transaction a new id in place (sharing resilience §5, fix round 3): the same row, lines and figures under a
 * fresh uuidv7, every local row that names it (`refs`: table and column) following. For a trade's or a sale's
 * transaction kept from a joined copy being erased, whose old id is a lineage id in the relay's log and in the
 * partners' copies: kept under it, a later share of the same workspace would book it a second time. Nothing moves:
 * entry ids, amounts, accounts, rates and dates stay. The caller leaves the copy's own sync rows (its lineages) out of
 * `refs`; they go with the copy. Returns the new id.
 */
export async function rekeyTransactionTx(tx: Db, ws: WorkspaceContext, id: string, refs: readonly (readonly [table: string, column: string])[]): Promise<string> {
  const next = uuidv7();
  const columns = (await tx.values<[string]>(sql`SELECT name FROM pragma_table_info('transactions')`)).map(([name]) => name);
  const [[ref]] = (await tx.values<[string | null]>(sql`SELECT external_ref FROM transactions WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`)) as [[string | null]];
  // The copy goes in first (its lines must have a row to name) without its import identity, which is unique among posted
  // rows; the identity follows once the old row is gone.
  const picked = columns.map((column) => (column === 'id' ? sql`${next}` : column === 'external_ref' ? sql`NULL` : sql.raw(column)));
  await tx.run(sql`INSERT INTO transactions (${sql.raw(columns.join(', '))}) SELECT ${sql.join(picked, sql`, `)} FROM transactions WHERE id = ${id}`);
  for (const [table, column] of refs) {
    await tx.run(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = ${next} WHERE ${sql.raw(column)} = ${id}`);
  }
  // History and Activity name a transaction by `audit_log.entity_id`, which no foreign key holds: they follow too.
  await tx.run(sql`UPDATE audit_log SET entity_id = ${next} WHERE entity = 'transaction' AND entity_id = ${id}`);
  await tx.run(sql`DELETE FROM transactions WHERE id = ${id}`);
  if (ref !== null) await tx.run(sql`UPDATE transactions SET external_ref = ${ref} WHERE id = ${next}`);
  return next;
}

/** Who is coming through a void or a replace. Only a shared event's derivation says `eventDerivation`. */
export interface LedgerDoor {
  /** An edit: a shared workspace's redacted transfer row follows the replacement instead of going void and back. */
  keepSharedTransfer?: boolean;
  /**
   * The caller is `postEventRecordTx` (or a refused join taken back), bringing a derived transaction in line with its
   * record. Every other door is refused on a derived transaction.
   */
  eventDerivation?: boolean;
  /** The caller is `fund-switch.ts` taking back a switch it wrote, both its trades with it. */
  fundSwitch?: boolean;
  /** The caller is `asset-sales.ts` taking back a sale it wrote (Undo sale). */
  assetSale?: boolean;
}

/** The words every other door says when it meets the money a sale of an asset brought in. */
export const ASSET_SALE_MESSAGE = 'This is the sale of an asset. Take it back with Undo sale on the asset’s page.';

const salesTableSeen = new WeakSet<object>();

/**
 * The money a sale brought in (`sellAsset`) is the sale's own: voided or edited from anywhere but Undo sale, the asset
 * would be left marked sold with nothing paid for it. Every other door is refused.
 */
async function guardAssetSaleTx(tx: Db, ws: WorkspaceContext, id: string): Promise<void> {
  if (!salesTableSeen.has(tx)) {
    const table = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_sales'`);
    if (table.length === 0) return;
    salesTableSeen.add(tx);
  }
  const sale = await tx.values<[string]>(sql`SELECT id FROM asset_sales WHERE transaction_id = ${id} AND workspace_id = ${ws.workspaceId}`);
  if (sale.length > 0) throw new LedgerError('ASSET_SALE', ASSET_SALE_MESSAGE);
}

/** The words every other door says when it meets a switch between two funds. */
export const FUND_SWITCH_MESSAGE = 'This is a switch between two funds. Change or delete it with Switch on either fund’s page.';

const tradesTableSeen = new WeakSet<object>();

/**
 * A switch between two funds tracked by money (`recordSwitch`) is two trades sharing this one transaction: voided or
 * edited from anywhere but the switch, the trades would be left pointing at nothing. Every such door is refused — except
 * a change another member made, applied here by household sharing (`author`), which cannot be refused: both trades are
 * retired with it, so the funds read as they would had the switch been deleted.
 */
async function guardFundSwitchTx(tx: Db, ws: WorkspaceContext, id: string, author: string | undefined): Promise<void> {
  if (!tradesTableSeen.has(tx)) {
    const table = await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'investment_trades'`);
    if (table.length === 0) return;
    tradesTableSeen.add(tx);
  }
  const sides = await tx.values<[string]>(
    sql`SELECT id FROM investment_trades WHERE transaction_id = ${id} AND workspace_id = ${ws.workspaceId} AND status = 'active'`,
  );
  if (sides.length < 2) return;
  if (!author) throw new LedgerError('FUND_SWITCH', FUND_SWITCH_MESSAGE);
  await tx.run(sql`UPDATE investment_trades SET status = 'deleted' WHERE transaction_id = ${id} AND workspace_id = ${ws.workspaceId} AND status = 'active'`);
}

/** The words every door but the event's says when it meets a transaction a shared event put here. */
export const EVENT_POSTING_MESSAGE = 'This follows a shared event’s record. Change it on the event.';

/**
 * A transaction a shared event put in this phone's books follows its record (shared events §5): deleting or editing it
 * anywhere but the event would leave it disagreeing with the record and every other phone. Worse, the derivation finds
 * its transaction void (or replaced) the next time the record changes and posts it again, so a card that a statement
 * check corrected, or a purchase converted, would be charged twice (final review C1). So the guard sits on the inner
 * doors every caller goes through (`markVoidTx`, under both void and replace), and only the derivation passes
 * `{ eventDerivation: true }`. A statement check, a conversion, an account deletion or anything written later is
 * refused here, with words the screen shows as they are.
 */
async function refuseEventPostingTx(tx: Db, id: string): Promise<void> {
  if (await eventPostingOfTx(tx, id)) throw new LedgerError('EVENT_POSTING', EVENT_POSTING_MESSAGE);
}

export async function voidTransaction(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  const before = await factsOf(database, ws, id);
  await database.transaction(async (tx) => {
    await voidTransactionTx(tx, ws, id);
    await recordActivityTx(tx, ws, 'delete', id);
  });
  await rederiveCardCycles(database, ws, before.accountIds, before.on ? [before.on] : []);
}

/** Edit = void the original and post the replacement atomically. */
export async function replaceTransaction(
  database: Database,
  ws: WorkspaceContext,
  id: string,
  input: PostTransactionInput,
): Promise<string> {
  const before = await factsOf(database, ws, id);
  const replacement = await database.transaction(async (tx) => {
    const replacement = await replaceTransactionTx(tx, ws, id, input);
    await recordActivityTx(tx, ws, 'edit', replacement, { replaces: id });
    return replacement;
  });
  await rederiveCardCycles(
    database,
    ws,
    [...before.accountIds, ...input.lines.map((line) => line.accountId)],
    [...(before.on ? [before.on] : []), input.occurredOn],
  );
  return replacement;
}

/**
 * One member of a group moved to a workspace: a spending row re-filed under the copies of its categories there, a bare
 * transfer filed there. Already there is left alone. A category with no copy in the workspace refuses the whole move.
 */
async function moveMemberTx(tx: Tx, ws: WorkspaceContext, id: string, toBookId: string): Promise<void> {
  const [row] = await tx.select({ occurredOn: transactions.occurredOn, description: transactions.description }).from(transactions).where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
  if (!row) return;
  const lines = await tx
    .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency, memo: entries.memo, spendCategoryId: entries.spendCategoryId, fxRateToBase: entries.fxRateToBase, kind: accounts.kind })
    .from(entries)
    .innerJoin(accounts, eq(accounts.id, entries.accountId))
    .where(eq(entries.transactionId, id));
  if (!lines.some((line) => line.kind === 'expense' || line.kind === 'income')) {
    await fileTransferTx(tx, ws, id, toBookId);
    return;
  }
  let changed = false;
  const swap = async (categoryId: string): Promise<string> => {
    const there = await categoryInBookTx(tx, ws, categoryId, toBookId);
    if (!there) throw new LedgerError('NO_CATEGORY_THERE', 'That workspace has no matching category for the fee, so the transfer and its fee cannot move together.');
    if (there !== categoryId) changed = true;
    return there;
  };
  const moved: PostingLine[] = [];
  for (const line of lines) {
    moved.push({
      accountId: line.kind === 'expense' || line.kind === 'income' ? await swap(line.accountId) : line.accountId,
      amountMinor: line.amountMinor,
      currency: line.currency,
      memo: line.memo,
      ...(line.spendCategoryId ? { spendCategoryId: await swap(line.spendCategoryId) } : {}),
    });
  }
  if (!changed && (await filedBooksTx(tx, ws, id)).includes(toBookId)) return;
  await replaceTransactionTx(tx, ws, id, {
    occurredOn: row.occurredOn,
    description: row.description,
    lines: moved,
    ratesToBase: Object.fromEntries(lines.map((line) => [line.currency, line.fxRateToBase])),
    moveToBook: true,
  });
}

/**
 * `replaceTransaction` inside a transaction already running (check #13: apply corrects a purchase inside its own db
 * transaction, and the mutex is not reentrant). The replacement always gets a fresh id: `input.id` is dropped.
 */
export async function replaceTransactionTx(tx: Tx, ws: WorkspaceContext, id: string, withId: PostTransactionInput, door: LedgerDoor = {}): Promise<string> {
  /*
   * An edit never posts a second settlement: the one a purchase paid off before the app has follows it below. Asked
   * outright (`settledBeforeApp` true or false), the edit adds the settlement or takes it away; left out, it follows.
   */
  const { id: _ignored, settledBeforeApp: settleCard, pastPurchase, moveToBook, toBookId, fileTransfer: _file, acrossBooks, ...input } = withId;
  void _file;
  void _ignored;
  const settle = settleCard ?? pastPurchase;
  // Before anything is read or written: a derived transaction is the event's to change (C1). `markVoidTx` says it again.
  if (!door.eventDerivation) await refuseEventPostingTx(tx, id);
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
      occurredOn: transactions.occurredOn,
    })
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
  const [placed] = (await dayOrderExists(tx)) ? await tx.values<[number | null]>(sql`SELECT day_order FROM transactions WHERE id = ${id}`) : [];
  const [typed] = (await exactExists(tx)) ? await tx.values<[number | null]>(sql`SELECT exact_hundredths FROM transactions WHERE id = ${id}`) : [];
  const [settles] = (await billTablesExist(tx))
    ? await tx.select({ billMonth: billPayments.billMonth, templateId: billPayments.templateId }).from(billPayments).where(eq(billPayments.transactionId, id))
    : [];
  // Two workspaces can hold copies of one category, alike on any screen. An edit is a correction to the same
  // spending, so it stays where it was filed: a category from another workspace is refused here, before
  // anything is voided, whatever form or import offered it.
  // A purchase split across workspaces stays one unless the edit says otherwise, and stays filed where it was so long as
  // a part is still there: splitting a purchase, or taking a split back to one of its workspaces, is an ordinary edit.
  let splitAcross = acrossBooks;
  let filedBefore: string[] = [];
  if (await hasBooks(tx)) {
    const filed = await filedBooksTx(tx, ws, id);
    filedBefore = filed;
    splitAcross = acrossBooks ?? filed.length > 1;
    if (filed.length > 0) {
      const lineIds = [...new Set(input.lines.map((line) => line.accountId))];
      const lineAccounts = lineIds.length
        ? await tx
            .select({ id: accounts.id, kind: accounts.kind })
            .from(accounts)
            .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, lineIds)))
        : [];
      const replacementBooks = await booksOfCategories(tx, lineAccounts, splitAcross);
      // Moving re-files the whole purchase in one workspace, which a split's parts in two cannot be by one choice.
      if (moveToBook && (filed.length > 1 || replacementBooks.length > 1)) {
        throw new LedgerError('SPLIT_MOVE', 'A purchase split across workspaces keeps its parts where they are. Change a part’s category in its split instead.');
      }
      if (replacementBooks.length > 0 && !replacementBooks.some((book) => filed.includes(book)) && !moveToBook) {
        throw new LedgerError('OTHER_BOOK', 'That category belongs to another workspace. A transaction stays in the workspace it was filed in.');
      }
    }
  }
  // What the original said about itself, so a correction that does not mention a fact keeps it, and one that
  // mentions it — `channel: null` — clears it. Read before the void, written as part of the replacement.
  const extras = (await extrasTablesExist(tx)) ? await extrasForTx(tx, ws, id) : null;
  // Which of a split's parts were left out of their workspace's reports (0090): carried workspace by workspace, as the
  // lines of the correction that are still in each such workspace.
  const carriedParts = input.excludedParts === undefined ? carriedLines(input.lines, await excludedLinesTx(tx, id)) : undefined;
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
  // A withdrawal's or top-up's other half, found before the original is voided; it moves with this one (`toBookId`).
  const partner = toBookId && moveToBook ? await moneyInPartnerTx(tx, ws, id) : null;
  const hadCategory = (await tx.values(sql`
    SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${id} AND a.kind IN ('income', 'expense') LIMIT 1`)).length > 0;
  // A transfer shown to a shared workspace's partner: its redacted row follows the edit (read before the void).
  const sharedTransferBooks = await sharedTransferBooksTx(tx, id);
  // An edit voids without reopening a deposit event: the replacement carries on what the original was.
  await markVoidTx(tx, ws, id, { answer: keepAnswer, tagged: keepTagged }, input.syncAuthor, { ...door, keepSharedTransfer: true });
  if (moveToBook) await voidSharedTransferTx(tx, id);
  // The same spend answered afresh (from another account) stays on the stage it paid: never the next one.
  const setAside = keepAnswer ? null : withSavedStage(answered, saved);
  // Keep import identity so re-importing the same statement still recognises the row.
  const replacement = await postTransactionTx(tx, ws, {
    ...input,
    acrossBooks: splitAcross,
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
    ...(carriedParts !== undefined ? { excludedParts: carriedParts } : {}),
    // A correction is still the same spending, so it stays with the event it was tagged to — unless it says otherwise.
    ...(input.eventId === undefined ? { eventId: original?.eventId ?? null } : {}),
    // A correction keeps its place in its day; moved to another day it goes to the top of that one.
    ...(input.dayOrder === undefined ? { dayOrder: original && original.occurredOn === input.occurredOn ? (placed?.[0] ?? null) : null } : {}),
    // The figure typed with cents stays while the edit moves the same money (a new note, date or category); a new
    // amount is a new figure, which a correction that does not say what it was typed as has not got.
    ...(input.exactHundredths === undefined ? { exactHundredths: await carriedExactTx(tx, typed?.[0] ?? null, oldLines, input.lines) } : {}),
    setAside,
  });
  // A purchase linked to a bill's month after the fact has no bill of its own, so posting would drop the link: carry it.
  if (settles && !original?.templateId && !input.templateId) {
    await tx.insert(billPayments).values({ transactionId: replacement, workspaceId: ws.workspaceId, templateId: settles.templateId, billMonth: settles.billMonth }).onConflictDoNothing();
  }
  /*
   * A transfer has no category to file it by. Moved, it is filed in the chosen workspace (and so leaves the others'
   * lists); edited without a move, one that was filed stays filed. Its partner, a fee or a transfer, follows the move.
   */
  if (await hasBooks(tx)) {
    const [hasRow] = await tx.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${replacement} LIMIT 1`);
    const [hasSplit] = (await bookSplitsExist(tx)) ? await tx.values(sql`SELECT 1 FROM book_transaction_splits WHERE transaction_id = ${replacement} LIMIT 1`) : [];
    if (!hasRow && !hasSplit) {
      if (moveToBook && toBookId) await fileTransferTx(tx, ws, replacement, toBookId);
      else if (!hadCategory && filedBefore.length === 1) await tx.insert(bookTransactions).values({ transactionId: replacement, workspaceId: ws.workspaceId, bookId: filedBefore[0]! });
    }
    if (partner && toBookId) await moveMemberTx(tx, ws, partner, toBookId);
  }
  if (sharedTransferBooks.length > 0 && !moveToBook) await carrySharedTransferTx(tx, ws, sharedTransferBooks, replacement);
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
  // A purchase paid off before the app keeps its settlement level with it: the edited figure, day and card — or, no
  // longer on a credit card, none at all.
  const settlement = await settlementOfTx(tx, ws, id);
  if (settlement && settle !== false) {
    const next = await settlementInputOf(tx, ws, replacement, input);
    if (next) await replaceTransactionTx(tx, ws, settlement, next);
    else await voidTransactionTx(tx, ws, settlement);
  } else if (settlement) await voidTransactionTx(tx, ws, settlement);
  else if (settle === true) await settleBeforeAppTx(tx, ws, replacement, input);
  return replacement;
}

/** The categories among these lines that the original had left out (0090, 0096): how a carried exclusion is named again. */
function carriedLines(lines: readonly PostingLine[], was: ReadonlySet<string>): string[] {
  return [...new Set(lines.map((line) => line.accountId))].filter((accountId) => was.has(accountId));
}

/**
 * The original's exact figure, when an edit that does not mention it still moves the same money and still has the one
 * category line it belongs to (not a split, not a transfer); else none.
 */
async function carriedExactTx(
  tx: Db,
  exact: number | null,
  oldLines: readonly { amountMinor: number }[],
  lines: readonly { accountId: string; amountMinor: number }[],
): Promise<number | null> {
  if (exact === null || debitTotal(oldLines) !== debitTotal(lines)) return null;
  return exactForLinesTx(tx, Number(exact), lines);
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

/**
 * Says which card several purchases were made on, in place: which plastic paid is a fact about the purchase, not
 * money, so nothing is reposted. Every one must still stand and have a line on the account the card belongs to; one
 * that does not refuses the lot, so nothing is half done. Null takes the card off them. Returns how many were set.
 */
export function setTransactionsCard(database: Database, ws: WorkspaceContext, transactionIds: readonly string[], cardId: string | null): Promise<number> {
  return database.transaction(async (tx) => {
    const ids = [...new Set(transactionIds)];
    let accountId: string | null = null;
    if (cardId !== null) {
      const [card] = await tx
        .select({ accountId: cards.accountId, archivedAt: cards.archivedAt })
        .from(cards)
        .where(and(eq(cards.id, cardId), eq(cards.workspaceId, ws.workspaceId)));
      if (!card || card.archivedAt !== null) throw new LedgerError('CARD_NOT_FOUND', 'That card is not on any account here');
      accountId = card.accountId;
    }
    for (const id of ids) {
      const [row] = await tx
        .select({ status: transactions.status, description: transactions.description })
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.workspaceId, ws.workspaceId)));
      if (!row || row.status !== 'posted') throw new LedgerError('NOT_FOUND', `Transaction ${id} not found`);
      if (accountId !== null) {
        const [line] = await tx.select({ id: entries.id }).from(entries).where(and(eq(entries.transactionId, id), eq(entries.accountId, accountId))).limit(1);
        if (!line) throw new LedgerError('NOT_ON_CARD', `${row.description || 'A transaction'} is not on that card’s account`);
      }
    }
    for (const id of ids) {
      // Household sharing: a shared purchase's Paid with names the card's digits, so it goes out again.
      await captureCardChangingTx(tx, id);
      await tx.update(transactions).set({ cardId }).where(eq(transactions.id, id));
      await audit(tx, ws, 'set_card', id, { cardId });
    }
    return ids.length;
  });
}

/**
 * Moves one transaction within its day: `order` is that day's rows as they should now read, the moved one among them —
 * the rows a list shows, which may be fewer than the day holds when it is filtered. The rows it does not name stay where
 * they are: the shown rows are put back, in their new order, into the places they already held in the whole day. Writes
 * the moved row alone when its new neighbours in the whole day already have places (one write, one synced change), else
 * numbers the day once. Nothing is reposted: a place in the day is not money.
 */
export function moveTransactionInDay(database: Database, ws: WorkspaceContext, transactionId: string, order: readonly string[]): Promise<void> {
  return database.transaction(async (tx) => {
    const ids = [...new Set(order)];
    if (!ids.includes(transactionId)) throw new LedgerError('NOT_FOUND', `Transaction ${transactionId} is not in the order given`);
    const [movedRow] = await tx.values<[string, string]>(
      sql`SELECT occurred_on, status FROM transactions WHERE workspace_id = ${ws.workspaceId} AND id = ${transactionId}`,
    );
    if (!movedRow || movedRow[1] !== 'posted') throw new LedgerError('NOT_FOUND', `Transaction ${transactionId} not found`);
    const occurredOn = movedRow[0];
    // The whole day as it reads now (the list's own rule), hidden rows included.
    const whole = (
      await tx.values<[string, number | null, string]>(
        sql`SELECT id, day_order, created_at FROM transactions WHERE workspace_id = ${ws.workspaceId} AND status = 'posted' AND occurred_on = ${occurredOn}`,
      )
    )
      .map(([id, dayOrder, createdAt]) => ({ id, dayOrder: dayOrder === null ? null : Number(dayOrder), createdAt }))
      .sort(compareWithinDay);
    const at = new Map(whole.map((row, i) => [row.id, i]));
    for (const id of ids) {
      if (at.has(id)) continue;
      const [row] = await tx.values<[string, string]>(sql`SELECT occurred_on, status FROM transactions WHERE workspace_id = ${ws.workspaceId} AND id = ${id}`);
      if (!row || row[1] !== 'posted') throw new LedgerError('NOT_FOUND', `Transaction ${id} not found`);
      // Moving to another day is changing the date: an edit, not a drag.
      throw new LedgerError('OTHER_DAY', 'A transaction can only be moved within its own day. Change its date to move it to another day.');
    }
    const slots = ids.map((id) => at.get(id)!).sort((x, y) => x - y);
    const next = [...whole];
    slots.forEach((slot, k) => (next[slot] = whole[at.get(ids[k]!)!]!));
    for (const write of planDayOrder(next, transactionId)) {
      // Household sharing: a shared purchase's place travels with it (the purchase's `dayOrder`).
      await captureReorderingTx(tx, write.id);
      await tx.run(sql`UPDATE transactions SET day_order = ${write.dayOrder} WHERE id = ${write.id}`);
      // A place in the day is the order money moved in (R3, R13): the day's foreign outflows are priced again.
      await markForeignDirtyTx(tx, ws, write.id);
      await audit(tx, ws, 'reorder', write.id, { dayOrder: write.dayOrder });
    }
  });
}

export interface TransactionEntryView {
  id: string;
  accountId: string;
  /** The account's name as a screen shows it: an account at a bank with its bank in front (`accountDisplayName`). */
  accountName: string;
  accountKind: 'asset' | 'liability' | 'income' | 'expense' | 'equity';
  /**
   * What kind of account the line is on — `receivable` and `payable` are money between you and a person. Optional
   * so a view built by hand in a test need not name it; every view read from the ledger carries it.
   */
  accountSubtype?: string;
  /** The ledger's own key on a system account — `balance_correction` tells a correction from an opening balance. */
  accountSystemKey?: string | null;
  amountMinor: number;
  currency: string;
  fxRateToBase: number;
  amountBaseMinor: number;
  memo: string | null;
  /** Category of a card purchase whose other side is an asset. */
  spendCategoryId: string | null;
  /**
   * On a purchase split across workspaces (0084), the workspace this category line is filed in: what tells one
   * workspace's part from another's. Absent on every other line, and on every other transaction.
   */
  bookId?: string;
  /**
   * This category line is left out of its workspace's reports on its own (0096) — or its workspace's part of a split is
   * (0090) — while the card keeps the whole charge. A purchase excluded whole is `TransactionView.excluded`, not marked
   * here. Absent (counted) on a line view built by hand, on a database stopped before 0096, and on every non-category line.
   */
  excluded?: boolean;
}

/** A workspace a purchase split across workspaces has a part in. */
export interface SplitBook {
  id: string;
  name: string;
  kind: BookKind;
  /**
   * This part is left out of the workspace's reports (0090): out of its chart, budgets and totals, while the card keeps
   * the whole charge. Absent (counted) on a view built by hand, and on a database stopped before 0090.
   */
  excluded?: boolean;
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
  /**
   * Its place within its day when moved there by hand, or null (0067): what the list sorts a day by. Optional so a
   * view built by hand need not name it.
   */
  dayOrder?: number | null;
  /**
   * A purchase on a money account that is a past purchase (`pastPurchase`): its balancing pair stands beside it, so
   * its account's balance does not hold it. Absent on anything else, so a view built by hand need not name it.
   */
  past?: boolean;
  /**
   * The amount as typed with cents, in hundredths, when it had any (0068); null otherwise. Never shown: every screen
   * reads the whole figure on the lines. What card points are worked out from, and what an edit that keeps the amount
   * passes back. Optional so a view built by hand need not name it; every view read from the ledger carries it.
   */
  exactHundredths?: number | null;
  /**
   * A purchase split across workspaces (0084): each workspace it has a part in, in the order the switcher shows them.
   * Its category lines say which part is whose (`TransactionEntryView.bookId`); its lines stay the whole purchase, as
   * the card was charged. Absent on anything else, so a view built by hand need not name it.
   */
  splitBooks?: SplitBook[];
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
  /** Also read the balancing pair beside a past purchase (Before the app), which a list never shows: it is not an event. */
  includeBalancing?: boolean;
}

async function listWith(database: Database, ws: WorkspaceContext, opts: ListTransactionsOptions, money: BookMoney): Promise<TransactionView[]> {
  const conds: SQL[] = [eq(transactions.workspaceId, ws.workspaceId)];
  if (!opts.includeVoid) conds.push(eq(transactions.status, 'posted'));
  // One row by id: what a receipt reads.
  if (opts.id) conds.push(eq(transactions.id, opts.id));
  // An event's own history: what was tagged to it, whenever it happened.
  if (opts.eventId) conds.push(eq(transactions.eventId, opts.eventId));
  // The balancing pair beside a past purchase is bookkeeping, not something that happened: no list, search or history
  // shows it (a card's settlement against Opening Balances is a different row and is left as it was).
  if (!opts.includeBalancing) {
    conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM entries WHERE account_id IN (SELECT id FROM accounts WHERE system_key = 'before_the_app'))`);
  }
  if (opts.from) conds.push(gte(transactions.occurredOn, opts.from));
  if (opts.to) conds.push(lte(transactions.occurredOn, opts.to));
  if (opts.accountId) {
    conds.push(sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id = ${opts.accountId})`);
  }
  // A parent category stands for everything under it, so its children are asked for by id as well.
  if (opts.accountIds && opts.accountIds.length > 0) {
    conds.push(sql`${transactions.id} IN (SELECT transaction_id FROM entries WHERE account_id IN ${opts.accountIds})`);
  }
  // A book's list: what was filed in it, and what was filed nowhere — moving your own money shows in every book. What
  // a shared event put in this phone's books is filed nowhere too, and shows in no book (shared events §5.1): read
  // owner-wide (an account's history, a receipt, the event page) it is still there.
  const bookId = opts.bookId ?? ws.bookId;
  if (bookId) {
    conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM book_transactions WHERE book_id <> ${bookId})`);
    // A purchase split across workspaces is filed in none of them by that table: it shows where it has a part (0084).
    if (await bookSplitsExist(database.db)) conds.push(splitHasPartIn(transactions.id, bookId));
    if (await eventOnlyExists(database.db)) conds.push(notEventOnly(transactions.id));
    // A transfer recorded in a shared workspace (0094) is listed by that workspace alone, as one filed in a book is.
    if ((await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_transfers'`)).length > 0) {
      conds.push(sql`${transactions.id} NOT IN (SELECT transaction_id FROM shared_transfers WHERE transaction_id IS NOT NULL AND void = 0 AND book_id <> ${bookId})`);
    }
  }
  // Within a day (compareWithinDay): rows never moved first, newest first; then moved rows by their place. A database
  // stopped before 0067 has no places: every day reads newest first, as it always did.
  const placed = await dayOrderExists(database.db);
  const typed = await exactExists(database.db);
  const txs = await database.db
    .select({
      ...getTableColumns(transactions),
      dayOrder: placed ? sql<number | null>`day_order` : sql<null>`NULL`,
      exactHundredths: typed ? sql<number | null>`exact_hundredths` : sql<null>`NULL`,
    })
    .from(transactions)
    .where(and(...conds))
    .orderBy(...(placed ? [desc(transactions.occurredOn), sql`day_order IS NOT NULL`, sql`day_order`, desc(transactions.createdAt)] : [desc(transactions.occurredOn), desc(transactions.createdAt)]))
    .limit(opts.limit ?? 500);
  if (txs.length === 0) return [];

  const rows = await database.db
    .select({
      id: entries.id,
      transactionId: entries.transactionId,
      accountId: entries.accountId,
      accountName: accounts.name,
      accountKind: accounts.kind,
      accountSubtype: accounts.subtype,
      accountSystemKey: accounts.systemKey,
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

  // A purchase split across workspaces: which workspace each of its category lines is in, and the workspaces' names.
  const parts = await splitPartsOfMany(database.db, txs.map((t) => t.id));
  const splits = new Map([...parts].map(([transactionId, list]) => [transactionId, list.map((part) => part.bookId)]));
  const splitBooks = splits.size > 0 ? await splitBooksNamed(database, ws, rows.filter((row) => splits.has(row.transactionId)).map((row) => row.accountId)) : null;

  // An account at a bank is named with its bank, as every list of accounts names it ("Mandiri Xpresi").
  const banks = await accountBanksTx(database.db, rows.filter((row) => BANK_NAMED_SUBTYPES.includes(row.accountSubtype)).map((row) => row.accountId));
  for (const row of rows) {
    const bank = banks.get(row.accountId);
    if (bank) row.accountName = accountDisplayName({ name: row.accountName, subtype: row.accountSubtype, bank });
  }

  // The lines left out of their workspace's reports on their own (0096), and those of a part left out whole (0090).
  const lineOff = await lineExclusionsOfMany(database.db, txs.map((t) => t.id));
  const byTx = new Map<string, TransactionEntryView[]>();
  for (const { transactionId, ...entry } of rows) {
    const filedIn = splits.has(transactionId) ? splitBooks?.byCategory.get(entry.accountId) : undefined;
    const isCategory = entry.accountKind === 'expense' || entry.accountKind === 'income';
    const off =
      isCategory &&
      (lineOff.get(transactionId)?.has(entry.accountId) ||
        (filedIn !== undefined && (parts.get(transactionId)?.some((part) => part.bookId === filedIn && part.excluded) ?? false)));
    const list = byTx.get(transactionId) ?? [];
    list.push({ ...entry, ...(filedIn ? { bookId: filedIn } : {}), ...(off ? { excluded: true } : {}) });
    byTx.set(transactionId, list);
  }
  // Which of these carry the past mark: their balancing pair is posted, found by its ref and its Before the app line.
  const past = new Set(
    (
      await database.db.values<[string]>(sql`
        SELECT substr(t.external_ref, ${'before-app:'.length + 1}) FROM transactions t
        WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND t.external_ref IN ${txs.map((t) => beforeAppRef(t.id))}
          AND t.id IN (SELECT e.transaction_id FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.system_key = 'before_the_app')`)
    ).map((row) => row[0]),
  );
  const views = txs.map((t) => ({
    id: t.id,
    ...(past.has(t.id) ? { past: true } : {}),
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
    dayOrder: t.dayOrder === null ? null : Number(t.dayOrder),
    exactHundredths: t.exactHundredths === null ? null : Number(t.exactHundredths),
    ...(splits.has(t.id) && splitBooks
      ? {
          splitBooks: splitBooks.books
            .filter((book) => splits.get(t.id)!.includes(book.id))
            .map((book) => {
              // A part is out when it is marked so whole, or when every one of its category lines is out on its own.
              const lines = (byTx.get(t.id) ?? []).filter((entry) => entry.bookId === book.id && (entry.accountKind === 'expense' || entry.accountKind === 'income'));
              return { ...book, excluded: parts.get(t.id)!.some((part) => part.bookId === book.id && part.excluded) || (lines.length > 0 && lines.every((entry) => entry.excluded === true)) };
            }),
        }
      : {}),
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

/** The workspace each of these categories is filed in, and every workspace of the owner's in the switcher's order. */
async function splitBooksNamed(database: Database, ws: WorkspaceContext, categoryIds: readonly string[]): Promise<{ byCategory: Map<string, string>; books: SplitBook[] }> {
  const ids = [...new Set(categoryIds)];
  const filed = ids.length
    ? await database.db.values<[string, string]>(sql`SELECT category_account_id, book_id FROM book_categories WHERE category_account_id IN ${ids}`)
    : [];
  const books = await database.db.values<[string, string, BookKind]>(
    sql`SELECT id, name, kind FROM books WHERE workspace_id = ${ws.workspaceId} ORDER BY sort_order, created_at`,
  );
  return { byCategory: new Map(filed), books: books.map(([id, name, kind]) => ({ id, name, kind })) };
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

/**
 * Every account with at least one posted entry in the workspace, on any date: what Cashflow's Paid with filter lists, so
 * an account nothing was ever recorded on (a Cash IDR left empty) is not offered.
 */
export async function accountIdsInUse(database: Database, ws: WorkspaceContext): Promise<string[]> {
  const rows = await database.db.values<[string]>(sql`
    SELECT DISTINCT e.account_id FROM entries e JOIN transactions t ON t.id = e.transaction_id
    WHERE e.workspace_id = ${ws.workspaceId} AND t.status = 'posted'`);
  return rows.map((row) => row[0]);
}

/** Raw debit-positive sums of posted entries per account, in each account's entry currency, up to asOf inclusive. */
export async function nativeBalances(
  database: Database,
  ws: WorkspaceContext,
  asOf?: string,
): Promise<Record<string, number>> {
  return nativeBalancesTx(database.db, ws, asOf);
}

/** `nativeBalances` inside an open transaction, so a write can read the balance it is about to change. */
export async function nativeBalancesTx(db: Db, ws: WorkspaceContext, asOf?: string): Promise<Record<string, number>> {
  const conds: SQL[] = [eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')];
  if (asOf) conds.push(lte(transactions.occurredOn, asOf));
  const rows = await db
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
