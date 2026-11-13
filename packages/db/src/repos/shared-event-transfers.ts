import { FX_LOT_SUBTYPES, isExchangeResultKey, type PostingLine, transferName } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { captureRevaluingTx, localDeviceId, withCapture } from '../sync/capture';
import { meetsVersion } from '../sync/events/version';
import { namespaceOf, uuidv5 } from '../sync/uuidv5';
import { postTransactionTx, replaceTransactionTx } from './ledger';
import { eventBookOfEventTx, type EventBookRow } from './shared-event-records';
import { postEventRecordTx } from './shared-event-postings';
import { fileSharedTransferTx, partnerTransferNameTx } from './shared-transfers';
import { partnerPurchaseRefusalTx } from './shared-workspace-rows';

/*
 * A household-shared workspace's transfer listed on a shared event (trip withdrawal, owner, 13 Nov 2026): an ATM
 * withdrawal for the trip leaves the workspace's list on every phone and shows on the trip's day list, grey, not
 * counted — no share, no total, no balance, no settle-up. Nothing on the event's own book changes, so the event's other
 * people never see it: the row is the workspace's redacted transfer (`shared_transfers`, 0094), naming the event by its
 * book id (`event_book_id`, 0114), which the household's phones alone hold. The ledger transaction is never touched:
 * the accounts' history and balances stay exactly as they were.
 *
 * Only the phone that recorded the transfer lists it or takes it off (the row is its recorder's to write, as a purchase
 * is its payer's to move). Every message names things and never says "you" (the owner's rule).
 */

/**
 * The first app version that reads `event_book_id` (0114). An older build applies the row's other fields and passes this
 * one over, keeping its clock: it would list the transfer in the workspace for ever, even once updated. So a transfer is
 * listed on an event only while every other device in the workspace says it runs this version or later.
 */
export const TRIP_TRANSFERS_MIN_APP_VERSION = '0.5.2';

const KEY = 'book_transfer';

/** One transfer listed on a shared event, as the event page shows it. */
export interface SharedEventTransferView {
  /** The workspace's row id: the root of the transfer's replaces chain, the same on every phone. */
  transferId: string;
  occurredOn: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** Who recorded it, by the name the workspace knows them by. */
  recordedByName: string;
  /**
   * The account the money left and the one it reached. On the recorder's phone, its own accounts' names; on the
   * partner's, only an account its owner shares with the household (a private side is null).
   */
  fromName: string | null;
  toName: string | null;
  /**
   * What the two accounts make the transfer ("Cash withdrawal"): on the recorder's phone from its own accounts; on the
   * partner's from the recorder's net-worth items (`partnerTransferNameTx`), so only when both sides are shared.
   * Null otherwise, and the row keeps its note as its title.
   */
  name?: string | null;
  /** The recorder's own transaction, on the recorder's phone: what a tap opens. Null on the partner's phone. */
  transactionId: string | null;
}

interface LiveRow {
  bookId: string;
  transferId: string;
  eventBookId: string | null;
}

/** The workspace row a live transfer recorded on this phone stands behind, or null. */
async function liveRowTx(tx: Db, transactionId: string): Promise<LiveRow | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_transfers'`)).length === 0) return null;
  const [row] = await tx.values<[string, string, string | null]>(sql`
    SELECT book_id, transfer_id, event_book_id FROM shared_transfers WHERE transaction_id = ${transactionId} AND void = 0 ORDER BY book_id LIMIT 1`);
  return row ? { bookId: row[0], transferId: row[1], eventBookId: row[2] } : null;
}

/** The other devices in the workspace on a build that would keep the transfer in it, by name. */
async function devicesBelowTx(tx: Db, bookId: string): Promise<string[]> {
  const self = await localDeviceId(tx);
  const rows = await tx.values<[string, string, string | null]>(sql`
    SELECT device_id, name, app_version FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL ORDER BY name, device_id`);
  return rows.filter(([id, , version]) => id !== self && !meetsVersion(version, TRIP_TRANSFERS_MIN_APP_VERSION)).map(([, name]) => name || 'another phone');
}

/**
 * The other devices in the workspace that are not in the event (`book_devices` of each book; a device's id is the same in
 * every book it is in), by name. On one of them the transfer would leave the workspace's list and be on no trip page.
 */
async function devicesNotInEventTx(tx: Db, bookId: string, eventBookId: string): Promise<string[]> {
  const self = await localDeviceId(tx);
  const rows = await tx.values<[string, string]>(sql`
    SELECT device_id, name FROM book_devices
    WHERE book_id = ${bookId} AND removed_at IS NULL
      AND device_id NOT IN (SELECT device_id FROM book_devices WHERE book_id = ${eventBookId} AND removed_at IS NULL)
    ORDER BY name, device_id`);
  return rows.filter(([id]) => id !== self).map(([, name]) => name || 'another phone');
}

/** The shared workspace a transaction is filed in (`book_transactions`), or null: filed nowhere, or in no shared one. */
async function sharedFiledBookTx(tx: Db, transactionId: string): Promise<string | null> {
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length === 0) return null;
  const [row] = await tx.values<[string]>(sql`
    SELECT bt.book_id FROM book_transactions bt JOIN shared_books s ON s.book_id = bt.book_id
    WHERE bt.transaction_id = ${transactionId} AND s.state <> 'unshared' ORDER BY bt.book_id LIMIT 1`);
  return row?.[0] ?? null;
}

/** Why a transfer in no shared workspace stays: filed in no workspace, so it shows in every one; or in one no one shares. */
async function unsharedTransferRefusalTx(tx: Db, transactionId: string): Promise<string> {
  const filed = await tx.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`);
  if (filed.length === 0) return 'A transfer filed in no workspace shows in every one: only one in a workspace shared with a household moves into a shared event';
  return 'Only a transfer in a workspace shared with a household moves into a shared event';
}

interface LedgerLine {
  accountId: string;
  amountMinor: number;
  currency: string;
  amountBaseMinor: number;
  fxRateToBase: number;
  memo: string | null;
  spendCategoryId: string | null;
  kind: string;
  subtype: string;
  systemKey: string | null;
}

async function ledgerLinesTx(tx: Db, transactionId: string): Promise<LedgerLine[]> {
  const rows = await tx.values<[string, number, string, number, number, string | null, string | null, string, string, string | null]>(sql`
    SELECT e.account_id, e.amount_minor, e.currency, e.amount_base_minor, e.fx_rate_to_base, e.memo, e.spend_category_id, a.kind, a.subtype, a.system_key
    FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} ORDER BY e.rowid`);
  return rows.map(([accountId, amountMinor, currency, amountBaseMinor, fxRateToBase, memo, spendCategoryId, kind, subtype, systemKey]) => ({
    accountId,
    amountMinor: Number(amountMinor),
    currency,
    amountBaseMinor: Number(amountBaseMinor),
    fxRateToBase: Number(fxRateToBase),
    memo,
    spendCategoryId,
    kind,
    subtype,
    systemKey,
  }));
}

/**
 * What a transfer is made of: money accounts (cash, bank, wallet, deposit, broker cash, a card) and the app's own
 * Currency Exchange lines between two currencies, with money leaving one and reaching another. A holding bought, a loan
 * paid or a debt is no transfer, filed in a workspace or not: it never becomes a redacted row (review fix).
 */
function transferShaped(lines: readonly LedgerLine[]): boolean {
  const money = (l: LedgerLine) => (l.kind === 'asset' && FX_LOT_SUBTYPES.includes(l.subtype)) || (l.kind === 'liability' && l.subtype === 'credit_card');
  if (!lines.every((l) => money(l) || l.systemKey === 'currency_exchange')) return false;
  return lines.some((l) => money(l) && l.amountMinor > 0) && lines.some((l) => money(l) && l.amountMinor < 0);
}

const isMoneyLine = (line: LedgerLine) => (line.kind === 'asset' || line.kind === 'liability') && !['receivable', 'payable', 'event_balance'].includes(line.subtype);

/**
 * A fee typed on a transfer (the Add form's Fee row, an ATM fee): the row's one category line, spending above zero,
 * beside money that left one account and reached another, paid from the account the money left, in its currency. Never
 * an exchange's own gain or loss line (the withdrawal rate's bookkeeping), which is no fee anyone typed.
 */
function typedFeeOf(lines: readonly LedgerLine[]): { fee: LedgerLine; from: LedgerLine } | null {
  const categories = lines.filter((l) => l.kind === 'income' || l.kind === 'expense');
  if (categories.length !== 1) return null;
  const [fee] = categories;
  if (fee!.kind !== 'expense' || fee!.amountMinor <= 0 || isExchangeResultKey(fee!.systemKey)) return null;
  const money = lines.filter(isMoneyLine);
  if (!money.some((l) => l.amountMinor > 0)) return null;
  const from = money.filter((l) => l.amountMinor < 0 && l.currency === fee!.currency).sort((a, b) => a.amountMinor - b.amountMinor)[0];
  if (!from || -from.amountMinor <= fee!.amountMinor) return null;
  return { fee: fee!, from };
}

const postingOf = (line: LedgerLine, amountMinor = line.amountMinor, amountBaseMinor = line.amountBaseMinor): PostingLine => ({
  accountId: line.accountId,
  amountMinor,
  currency: line.currency,
  memo: line.memo,
  amountBaseMinor,
  ...(line.spendCategoryId ? { spendCategoryId: line.spendCategoryId } : {}),
});

const ratesOf = (lines: readonly LedgerLine[]): Record<string, number> => Object.fromEntries(lines.map((line) => [line.currency, line.fxRateToBase]));

/**
 * The trip expense a transfer's typed fee became on its `n`th move into the event (n from 0), named alike on every phone
 * that could ask: by the transfer's workspace row and the event. A fee taken back off the trip (Remove from event) is
 * voided there for good; moved in again it takes the next id, never the voided one back, so no phone ever has to read a
 * record come back from void (review fix).
 */
async function tripFeeExpenseId(transferId: string, eventBookId: string, n: number): Promise<string> {
  return uuidv5(await namespaceOf(eventBookId), n === 0 ? `trip-fee:${transferId}` : `trip-fee:${transferId}:${n}`);
}

/** The ids a transfer's fee has taken on this event so far, oldest first, with whether each is still live. */
async function tripFeeIdsTx(tx: Db, transferId: string, eventBookId: string): Promise<{ id: string; live: boolean }[]> {
  const out: { id: string; live: boolean }[] = [];
  for (let n = 0; n < 1_000; n += 1) {
    const id = await tripFeeExpenseId(transferId, eventBookId, n);
    const [row] = await tx.values<[string | null]>(sql`SELECT voided_at FROM event_expenses WHERE book_id = ${eventBookId} AND id = ${id}`);
    if (!row) return out;
    out.push({ id, live: row[0] === null });
  }
  return out;
}

/** The id a transfer's fee takes on this move into the event: the first of its ids no record has had. */
export async function nextTripFeeIdTx(tx: Db, transferId: string, eventBookId: string): Promise<string> {
  return tripFeeExpenseId(transferId, eventBookId, (await tripFeeIdsTx(tx, transferId, eventBookId)).length);
}

/** The fee expense a listed transfer has live on the event, or null. */
async function liveTripFeeIdTx(tx: Db, transferId: string, eventBookId: string): Promise<string | null> {
  return (await tripFeeIdsTx(tx, transferId, eventBookId)).filter((fee) => fee.live).at(-1)?.id ?? null;
}

/** A transfer listed on a shared event: the transaction it now is, and the fee purchase split off it to move as an expense. */
export interface TransferListing {
  transactionId: string;
  /** The workspace row's id (the transfer's lineage): what the fee's expense id is named by. */
  transferId: string;
  fee: string | null;
}

/**
 * What moving a transaction into a shared event does when it is a transfer: listed once its workspace row names the
 * event, the reason it stays when it cannot be listed, or null when it is no transfer (a purchase or a refund, which
 * move as expenses) — or no transaction here at all, which the purchase path reports.
 *
 * Three shapes of a household-shared workspace's transfer list (trip exchange fix, owner's report on build 122):
 * - one with its redacted row (0094): its figure is filed again first, so a row an older build wrote with the rupiah
 *   the exchange spread holds reads the lira that landed, on the partner's phone and the trip;
 * - one filed in the workspace as a purchase, recorded before the workspace sent its transfers as redacted rows: it is
 *   filed as a transfer now (the partner's purchase copy is voided, the redacted row takes its place), then listed;
 * - one with a fee typed on it: the fee is split off into a purchase of its own, from the same account, which the
 *   caller moves into the event as an expense (counted there, once), and the transfer itself is listed, not counted.
 * Every check that can refuse runs before anything is written. The ledger's balances never change: a split moves the
 * fee's money onto a row of its own, line for line.
 */
export async function transferIntoEventTx(tx: Tx, ws: WorkspaceContext, transactionId: string, book: EventBookRow): Promise<TransferListing | string | null> {
  const [head] = await tx.values<[string, string, string | null]>(sql`
    SELECT status, occurred_on, description FROM transactions WHERE id = ${transactionId} AND workspace_id = ${ws.workspaceId}`);
  if (!head || head[0] !== 'posted') return null;
  // A shared event's own posting (a settle-up, a share): the purchase path says so in its own words.
  if ((await tx.values(sql`SELECT 1 FROM event_postings WHERE transaction_id = ${transactionId}`)).length > 0) return null;
  const lines = await ledgerLinesTx(tx, transactionId);
  if (lines.length === 0) return null;
  const row = await liveRowTx(tx, transactionId);
  const categories = lines.filter((l) => l.kind === 'income' || l.kind === 'expense');
  const fee = row ? null : typedFeeOf(lines);
  let bookId: string;
  if (row) {
    if (row.eventBookId !== null) return 'Already in a shared event';
    bookId = row.bookId;
  } else if ((categories.length === 0 && transferShaped(lines)) || (fee && transferShaped(lines.filter((l) => l !== fee.fee)))) {
    const filed = await sharedFiledBookTx(tx, transactionId);
    if (!filed) return unsharedTransferRefusalTx(tx, transactionId);
    // A shared workspace's purchase another member paid is theirs to move (D3): only its recorder's phone splits it.
    const partners = await partnerPurchaseRefusalTx(tx, transactionId);
    if (partners) return partners;
    bookId = filed;
  } else {
    return null;
  }
  const below = await devicesBelowTx(tx, bookId);
  if (below.length > 0) {
    const [named] = await tx.values<[string]>(sql`SELECT name FROM books WHERE id = ${bookId}`);
    return `Update cicis on ${below.join(' and ')} first: until then it would stay in ${named?.[0] || 'the shared workspace'} there`;
  }
  // Every phone in the workspace must have the trip, or the transfer would vanish there (review fix round 1, M3).
  const outside = await devicesNotInEventTx(tx, bookId, book.bookId);
  if (outside.length > 0) return `${outside.join(' and ')} ${outside.length === 1 ? 'is' : 'are'} not in ${book.name}, so there it would show in neither place`;

  let listedId = transactionId;
  let feeId: string | null = null;
  if (fee) {
    // The transfer without its fee (its money leg lighter by the fee, every other line as it was); the fee a purchase
    // of its own, from the account the money left, filed by its category. The replacement is filed nowhere yet: its
    // redacted row below files it in the workspace, and the purchase it was leaves the partner's phone at flush.
    const rest = lines.filter((l) => l !== fee.fee).map((l) => (l === fee.from ? postingOf(l, l.amountMinor + fee.fee.amountMinor, l.amountBaseMinor + fee.fee.amountBaseMinor) : postingOf(l)));
    listedId = await replaceTransactionTx(tx, ws, transactionId, {
      occurredOn: head[1],
      description: head[2] ?? '',
      // A card's fee named its category on the card's line (points): the transfer left has no fee to name.
      lines: rest.map((line) => (line.spendCategoryId === fee.fee.accountId ? { ...line, spendCategoryId: null } : line)),
      ratesToBase: ratesOf(lines),
    });
    const [card] = await tx.values<[string | null]>(sql`SELECT card_id FROM transactions WHERE id = ${transactionId}`);
    feeId = await postTransactionTx(tx, ws, {
      occurredOn: head[1],
      description: head[2] ?? '',
      lines: [postingOf(fee.fee), { ...postingOf(fee.from, -fee.fee.amountMinor, -fee.fee.amountBaseMinor), spendCategoryId: fee.from.spendCategoryId ? fee.fee.accountId : null }],
      ratesToBase: ratesOf(lines),
      cardId: card?.[0] ?? null,
    });
  } else if (!row) {
    // Filed as a purchase before the workspace sent transfers as redacted rows: it leaves the book (the partner's copy,
    // if it ever took one, is voided at flush) and its redacted row takes its place.
    await captureRevaluingTx(tx, transactionId);
    await tx.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${transactionId}`);
  }
  // Its redacted row, figure read afresh (an older build's row read the rupiah the exchange spread holds, not the lira
  // that landed), listed on the event in the same write.
  if (!(await fileSharedTransferTx(tx, ws, listedId, bookId, book.bookId))) throw new Error('This transfer cannot be shown to the household');
  const listed = await liveRowTx(tx, listedId);
  if (!listed) throw new Error('The transfer has no workspace row to list');
  // An event tag an older build left on it never travelled: listed, it is on the event by the row alone, on every phone.
  await tx.run(sql`UPDATE transactions SET event_id = NULL WHERE id = ${listedId} AND event_id IS NOT NULL`);
  return { transactionId: listedId, transferId: listed.transferId, fee: feeId };
}

/**
 * Remove from event for a listed transfer: it is back in its workspace's list on every phone, and off the event. Allowed
 * whatever became of the event here (done, left, its copy deleted), so a transfer is never stranded off every list.
 * False when the transfer is on no event (nothing to do).
 */
export async function removeTransferFromSharedEvent(database: Database, ws: WorkspaceContext, transactionId: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    const [head] = await tx.values(sql`SELECT 1 FROM transactions WHERE id = ${transactionId} AND workspace_id = ${ws.workspaceId}`);
    if (!head) return false;
    const row = await liveRowTx(tx, transactionId);
    if (!row || row.eventBookId === null) return false;
    // Everything the fee's way back needs is read before anything is written.
    const fee = await feeBackPlanTx(tx, ws, transactionId, row.transferId, row.eventBookId);
    await withCapture(tx, { entity: KEY, id: row.transferId, bookId: row.bookId }, () =>
      tx.run(sql`UPDATE shared_transfers SET event_book_id = NULL WHERE book_id = ${row.bookId} AND transfer_id = ${row.transferId}`),
    );
    if (fee) await feeBackTx(tx, ws, transactionId, row.eventBookId, fee);
    return true;
  });
}

interface FeeBack {
  expenseId: string;
  derivedId: string;
  /** The category the fee was typed under. */
  categoryId: string;
  /** What the fee's expense takes from its account now (the derived transaction's money line, below zero). */
  paid: LedgerLine;
  /** The transfer's line that money left from, in the same account and currency, when it still has one. */
  onTransfer: boolean;
}

/**
 * How a transfer's fee comes back off the trip, read whole before anything is written; null when there is none to bring
 * back, or the event can no longer be written to here (done, left, its copy deleted), where it stays and is changed.
 */
async function feeBackPlanTx(tx: Db, ws: WorkspaceContext, transactionId: string, transferId: string, eventBookId: string): Promise<FeeBack | null> {
  const expenseId = await liveTripFeeIdTx(tx, transferId, eventBookId);
  if (!expenseId) return null;
  const [posting] = await tx.values<[string | null]>(sql`SELECT transaction_id FROM event_postings WHERE book_id = ${eventBookId} AND record_id = ${expenseId}`);
  const derivedId = posting?.[0];
  if (!derivedId) return null;
  const [event] = await tx.values<[string]>(sql`SELECT event_id FROM event_books WHERE book_id = ${eventBookId}`);
  const book = event ? await eventBookOfEventTx(tx, event[0]) : null;
  if (!book || book.workspaceId !== ws.workspaceId || book.state !== 'active' || book.finishedAt) return null;
  // What the expense takes from its account now (an edit on the trip may have changed it): exactly that comes back.
  const paid = (await ledgerLinesTx(tx, derivedId)).find((l) => isMoneyLine(l) && l.amountMinor < 0);
  // The category the fee was typed under: the fee purchase the expense first replaced, at the root of its chain.
  const [root] = await tx.values<[string]>(sql`
    WITH RECURSIVE chain(id, prev, depth) AS (
      SELECT id, replaces_transaction_id, 0 FROM transactions WHERE id = ${derivedId}
      UNION ALL
      SELECT t.id, t.replaces_transaction_id, c.depth + 1 FROM transactions t JOIN chain c ON t.id = c.prev WHERE c.depth < 50
    )
    SELECT id FROM chain ORDER BY depth DESC LIMIT 1`);
  const category = root ? (await ledgerLinesTx(tx, root[0])).find((l) => l.kind === 'expense') : undefined;
  if (!paid || !category) return null;
  const onTransfer = (await ledgerLinesTx(tx, transactionId)).some((l) => l.accountId === paid.accountId && l.currency === paid.currency && l.amountMinor < 0);
  return { expenseId, derivedId, categoryId: category.accountId, paid, onTransfer };
}

/**
 * The fee put back where it was: its expense voided on the event (its derived transaction with it, the money back on
 * its account), then the same money spent again under the category it was typed in, from the same account — on the
 * transfer's line when the transfer still leaves that account (one row, as before the move), else as a purchase of its
 * own (the transfer was edited to another account while listed). Either way every balance ends where it was.
 */
async function feeBackTx(tx: Tx, ws: WorkspaceContext, transactionId: string, eventBookId: string, fee: FeeBack): Promise<void> {
  await withCapture(tx, { entity: 'event_expense', id: fee.expenseId, bookId: eventBookId }, () =>
    tx.run(sql`UPDATE event_expenses SET voided_at = ${new Date().toISOString()} WHERE book_id = ${eventBookId} AND id = ${fee.expenseId}`),
  );
  await postEventRecordTx(tx, eventBookId, 'expense', fee.expenseId, null);
  const [derived] = await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${fee.derivedId}`);
  if (derived?.[0] !== 'void') throw new Error('The fee could not be taken off the event');
  const amountMinor = -fee.paid.amountMinor;
  const amountBaseMinor = -fee.paid.amountBaseMinor;
  const feeLine: PostingLine = { accountId: fee.categoryId, amountMinor, currency: fee.paid.currency, amountBaseMinor };
  const [head] = await tx.values<[string, string | null, string | null]>(sql`SELECT occurred_on, description, card_id FROM transactions WHERE id = ${transactionId}`);
  if (!head) throw new Error('The transfer is gone');
  const rates = { [fee.paid.currency]: fee.paid.fxRateToBase };
  if (fee.onTransfer) {
    const lines = await ledgerLinesTx(tx, transactionId);
    const from = lines.find((l) => l.accountId === fee.paid.accountId && l.currency === fee.paid.currency && l.amountMinor < 0)!;
    await replaceTransactionTx(tx, ws, transactionId, {
      occurredOn: head[0],
      description: head[1] ?? '',
      lines: [...lines.map((l) => (l === from ? postingOf(l, l.amountMinor - amountMinor, l.amountBaseMinor - amountBaseMinor) : postingOf(l))), feeLine],
      ratesToBase: { ...ratesOf(lines), ...rates },
    });
    return;
  }
  await postTransactionTx(tx, ownerScope(ws), {
    occurredOn: head[0],
    description: head[1] ?? '',
    lines: [feeLine, { accountId: fee.paid.accountId, amountMinor: -amountMinor, currency: fee.paid.currency, amountBaseMinor: -amountBaseMinor }],
    ratesToBase: rates,
  });
}

/**
 * The posted transaction a transaction stands as now: itself, or the replacement an edit made of it (following the
 * replaces chain forward). Remove from event puts a fee back on its transfer, which replaces it: the receipt follows.
 */
export async function standingTransaction(database: Database, transactionId: string): Promise<string> {
  const [row] = await database.db.values<[string]>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ${transactionId}, 0
      UNION ALL
      SELECT t.id, c.depth + 1 FROM transactions t JOIN chain c ON t.replaces_transaction_id = c.id WHERE c.depth < 50
    )
    SELECT c.id FROM chain c JOIN transactions t ON t.id = c.id WHERE t.status = 'posted' ORDER BY c.depth DESC LIMIT 1`);
  return row?.[0] ?? transactionId;
}

/** The event a transfer recorded here is listed on, for its receipt: the event's local id and name, or null when none. */
export async function eventTransferOf(database: Database, transactionId: string): Promise<{ eventId: string | null; eventName: string | null } | null> {
  const row = await liveRowTx(database.db, transactionId);
  if (!row || row.eventBookId === null) return null;
  const [event] = await database.db.values<[string, string | null]>(sql`
    SELECT e.event_id, s.name FROM event_books e LEFT JOIN shared_events s ON s.book_id = e.book_id WHERE e.book_id = ${row.eventBookId}`);
  return { eventId: event?.[0] ?? null, eventName: event?.[1] ?? null };
}

/** The account names of a transfer recorded here: the largest line out and the largest line in. */
async function ownNamesTx(db: Db, transactionId: string): Promise<{ fromName: string | null; toName: string | null; name: string | null }> {
  const lines = await db.values<[number, string, string, string]>(sql`
    SELECT e.amount_minor, a.name, a.subtype, e.currency FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} AND a.kind IN ('asset', 'liability')`);
  const out = lines.filter(([amount]) => Number(amount) < 0).sort((a, b) => Number(a[0]) - Number(b[0]))[0];
  const into = lines.filter(([amount]) => Number(amount) > 0).sort((a, b) => Number(b[0]) - Number(a[0]))[0];
  // Named only by a plain two-sided transfer; a fee line beside it is not a money account.
  const name = lines.length === 2 && out && into ? transferName({ subtype: out[2], currency: out[3] }, { subtype: into[2], currency: into[3] }) : null;
  return { fromName: out?.[1] ?? null, toName: into?.[1] ?? null, name };
}

/** The household's transfers listed on an event book, oldest first. Only a phone in that household holds any. */
export async function eventTransfersTx(db: Db, eventBookId: string): Promise<SharedEventTransferView[]> {
  if ((await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_transfers'`)).length === 0) return [];
  const rows = await db.values<[string, string, string, number, string, string, string, string | null, string | null, string | null, string | null, string | null, string | null]>(sql`
    SELECT t.transfer_id, t.book_id, t.occurred_on, t.amount_minor, t.currency, t.description, t.recorded_by, t.from_name, t.to_name, t.transaction_id,
           t.from_item, t.to_item,
           (SELECT m.name FROM book_members m WHERE m.book_id = t.book_id AND m.member_id = t.recorded_by)
    FROM shared_transfers t WHERE t.event_book_id = ${eventBookId} AND t.void = 0
    ORDER BY t.occurred_on, t.transfer_id`);
  const out: SharedEventTransferView[] = [];
  for (const [transferId, bookId, occurredOn, amountMinor, currency, description, recordedBy, fromName, toName, transactionId, fromItem, toItem, recordedByName] of rows) {
    // The recorder's own live transaction names its own accounts; a stale pointer (not posted here) names none of them.
    const [live] = transactionId ? await db.values(sql`SELECT 1 FROM transactions WHERE id = ${transactionId} AND status = 'posted'`) : [];
    const names = live
      ? await ownNamesTx(db, transactionId!)
      : { fromName, toName, name: await partnerTransferNameTx(db, bookId, recordedBy, { fromName, toName, fromItem, toItem }) };
    out.push({
      transferId,
      occurredOn,
      amountMinor: Number(amountMinor),
      currency,
      description,
      recordedByName: recordedByName || 'Someone',
      ...names,
      transactionId: live ? transactionId : null,
    });
  }
  return out;
}
