import { EXCHANGE_GAIN_KEY, EXCHANGE_GAIN_NAME, EXCHANGE_LOSS_KEY, EXCHANGE_LOSS_NAME, isExchangeResultKey, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { entries } from '../schema';
import { captureRevaluingTx } from '../sync/capture';
import { ensureSystemAccountTx } from './accounts';
import { hasBooks, personalBookIdTx } from './books';
import { ensureCategoryByKeyTx } from './categories';
import { eventPostingOfTx } from './event-only';

/*
 * The exchange gain or loss (withdrawal rate §5, ruling R8): one line on Exchange gain or Exchange loss in the owner's
 * base currency, and one on the exchange account that balances it, recorded in `fx_gain_loss` so the recalculation can
 * find, change or take away exactly its own two lines and never one an exchange was posted with. The transfer it sits
 * on is filed in Personal while it has the pair (the book `bookOfCategories` would find for that category), unless it
 * is a shared event's own transaction or a partner transfer's posting, which belong to no workspace (R7).
 */

export interface GainLossPair {
  categoryEntryId: string;
  exchangeEntryId: string;
  /** The category line's amount: negative for a gain (income is credited), positive for a loss. */
  amountMinor: number;
  key: string | null;
  /** False for a pair known only by its shape (I3): `writeGainLossTx` registers it. */
  registered: boolean;
}

/** A line as `pairByShape` reads it: its account's system key (a category's key, or 'currency_exchange'). */
export interface PairShapeLine {
  entryId: string;
  systemKey: string | null;
  currency: string;
  amountMinor: number;
}

/**
 * The gain or loss pair a transaction carries, known by its shape rather than by `fx_gain_loss` (final review I3): one
 * base-currency line on Exchange gain or Exchange loss, and a base-currency line on the exchange account of the opposite
 * amount, on a transaction that changes money (it has an exchange line in another currency). The registry names the
 * pair this phone wrote; a household partner's edit of the exchange comes back through apply as a new transaction, its
 * pair reposted as two ordinary lines with new ids, and only the shape still says what they are. Of several exchange
 * lines that would match, the last written: the pair is always written after the lines the exchange was posted with.
 */
export function pairByShape(lines: readonly PairShapeLine[], baseCurrency: string): { categoryEntryId: string; exchangeEntryId: string } | null {
  if (!lines.some((line) => line.systemKey === 'currency_exchange' && line.currency !== baseCurrency)) return null;
  const results = lines.filter((line) => isExchangeResultKey(line.systemKey) && line.currency === baseCurrency && line.amountMinor !== 0);
  if (results.length !== 1) return null;
  const result = results[0]!;
  const exchange = lines.filter((line) => line.systemKey === 'currency_exchange' && line.currency === baseCurrency && line.amountMinor === -result.amountMinor).at(-1);
  return exchange ? { categoryEntryId: result.entryId, exchangeEntryId: exchange.entryId } : null;
}

/**
 * The two entries of a transaction's gain or loss pair, by the registry and else by shape (I3); empty when it has none.
 * What a comparison of a transaction's lines leaves out: the pair is the recalculation's, never what was posted (I1).
 */
export async function pairEntryIdsOfTx(db: Db, transactionId: string, baseCurrency: string): Promise<Set<string>> {
  const rows = await db.values<[string, string | null, string, number, string | null, string | null]>(sql`
    SELECT e.id, a.system_key, e.currency, e.amount_minor, g.category_entry_id, g.exchange_entry_id
    FROM entries e JOIN accounts a ON a.id = e.account_id LEFT JOIN fx_gain_loss g ON g.transaction_id = e.transaction_id
    WHERE e.transaction_id = ${transactionId} ORDER BY e.rowid`);
  const ids = new Set(rows.map(([id]) => id));
  const registered = rows[0];
  if (registered && registered[4] && registered[5] && ids.has(registered[4]) && ids.has(registered[5])) return new Set([registered[4], registered[5]]);
  const shaped = pairByShape(
    rows.map(([entryId, systemKey, currency, amountMinor]) => ({ entryId, systemKey, currency, amountMinor: Number(amountMinor) })),
    baseCurrency,
  );
  return new Set(shaped ? [shaped.categoryEntryId, shaped.exchangeEntryId] : []);
}

/** The pair `transactionId` carries: the registered one, else (given the base currency) one known by its shape (I3). */
export async function gainLossPairOfTx(db: Db, transactionId: string, baseCurrency?: string): Promise<GainLossPair | null> {
  const [row] = await db.values<[string, string, number, string | null]>(sql`
    SELECT g.category_entry_id, g.exchange_entry_id, e.amount_minor, a.system_key
    FROM fx_gain_loss g JOIN entries e ON e.id = g.category_entry_id JOIN accounts a ON a.id = e.account_id
    WHERE g.transaction_id = ${transactionId} AND e.transaction_id = ${transactionId}`);
  if (row) return { categoryEntryId: row[0], exchangeEntryId: row[1], amountMinor: Number(row[2]), key: row[3], registered: true };
  if (baseCurrency === undefined) return null;
  const lines = await db.values<[string, string | null, string, number]>(sql`
    SELECT e.id, a.system_key, e.currency, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.transaction_id = ${transactionId} ORDER BY e.rowid`);
  const shaped = pairByShape(
    lines.map(([entryId, systemKey, currency, amountMinor]) => ({ entryId, systemKey, currency, amountMinor: Number(amountMinor) })),
    baseCurrency,
  );
  if (!shaped) return null;
  const category = lines.find(([id]) => id === shaped.categoryEntryId)!;
  return { ...shaped, amountMinor: Number(category[3]), key: category[1], registered: false };
}

/** Personal's Exchange gain or Exchange loss, made there the first time one is needed (the ensure-by-key path, R8). */
export function exchangeCategoryTx(db: Db, ws: WorkspaceContext, gain: boolean): Promise<string> {
  const personal: WorkspaceContext = { workspaceId: ws.workspaceId, baseCurrency: ws.baseCurrency };
  return ensureCategoryByKeyTx(
    db,
    personal,
    gain ? { key: EXCHANGE_GAIN_KEY, name: EXCHANGE_GAIN_NAME, kind: 'income' } : { key: EXCHANGE_LOSS_KEY, name: EXCHANGE_LOSS_NAME, kind: 'expense' },
  );
}

const transferPostings = new WeakMap<object, true>();

/** Whether this copy has joint net worth's partner-transfer postings. Once seen it is remembered, as `hasBooks` does. */
async function transferPostingsExist(db: Db): Promise<boolean> {
  if (transferPostings.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'member_transfer_postings'`);
  if (rows.length > 0) transferPostings.set(db, true);
  return rows.length > 0;
}

/** A shared event's derived transaction, or this phone's side of a transfer with a partner: in no workspace, ever. */
export async function inNoWorkspaceTx(db: Db, transactionId: string): Promise<boolean> {
  if (await eventPostingOfTx(db, transactionId)) return true;
  if (!(await transferPostingsExist(db))) return false;
  return (await db.values(sql`SELECT 1 FROM member_transfer_postings WHERE transaction_id = ${transactionId}`)).length > 0;
}

/**
 * Makes `transactionId` carry exactly this gain (positive) or loss (negative), or no pair at zero. Returns whether it
 * wrote anything. The capture door is called before the first write, and again once the transaction is filed: a
 * transfer newly in a shared Personal book goes out as a purchase, and one leaving it as a void (Task 4).
 */
export async function writeGainLossTx(db: Db, ws: WorkspaceContext, transactionId: string, gainLossBaseMinor: number, known?: GainLossPair | null): Promise<boolean> {
  if (!Number.isSafeInteger(gainLossBaseMinor)) throw new Error(`An exchange gain or loss is a whole number of minor units, got ${gainLossBaseMinor}`);
  // `known`: the pair the caller already read (the recalculation reads every pair of an account in one query, I2).
  const pair = known !== undefined ? known : await gainLossPairOfTx(db, transactionId, ws.baseCurrency);
  const key = gainLossBaseMinor > 0 ? EXCHANGE_GAIN_KEY : EXCHANGE_LOSS_KEY;
  if (!pair && gainLossBaseMinor === 0) return false;
  if (pair && gainLossBaseMinor !== 0 && pair.amountMinor === -gainLossBaseMinor && pair.key === key) {
    // Already right. A pair known by its shape only — reposted by apply after a partner's edit (I3) — is this phone's
    // own again: registered, so every reader finds it. Nothing in the books changed, so nothing is sent.
    if (!pair.registered) {
      await db.run(sql`INSERT OR REPLACE INTO fx_gain_loss (transaction_id, category_entry_id, exchange_entry_id) VALUES (${transactionId}, ${pair.categoryEntryId}, ${pair.exchangeEntryId})`);
    }
    return false;
  }

  await captureRevaluingTx(db, transactionId);
  if (pair) {
    await db.run(sql`DELETE FROM entries WHERE id IN (${pair.categoryEntryId}, ${pair.exchangeEntryId})`);
    await db.run(sql`DELETE FROM fx_gain_loss WHERE transaction_id = ${transactionId}`);
  }
  if (gainLossBaseMinor === 0) {
    // Back to a plain transfer: filed nowhere once it has no category line left, as the ledger would have filed it.
    const [category] = await db.values(sql`
      SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} AND a.kind IN ('income', 'expense') LIMIT 1`);
    if (!category && (await hasBooks(db))) await db.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${transactionId}`);
    return true;
  }

  const categoryId = await exchangeCategoryTx(db, ws, gainLossBaseMinor > 0);
  const exchangeId = await ensureSystemAccountTx(db, ws, 'currency_exchange');
  const categoryEntryId = uuidv7();
  const exchangeEntryId = uuidv7();
  const line = (id: string, accountId: string, amountMinor: number) => ({
    id,
    workspaceId: ws.workspaceId,
    transactionId,
    accountId,
    amountMinor,
    currency: ws.baseCurrency,
    fxRateToBase: 1,
    amountBaseMinor: amountMinor,
    memo: null,
    spendCategoryId: null,
  });
  await db.insert(entries).values([line(categoryEntryId, categoryId, -gainLossBaseMinor), line(exchangeEntryId, exchangeId, gainLossBaseMinor)]);
  await db.run(sql`INSERT INTO fx_gain_loss (transaction_id, category_entry_id, exchange_entry_id) VALUES (${transactionId}, ${categoryEntryId}, ${exchangeEntryId})`);

  if ((await hasBooks(db)) && !(await inNoWorkspaceTx(db, transactionId))) {
    const [filed] = await db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${transactionId}`);
    const personal = filed ? null : await personalBookIdTx(db, ws.workspaceId);
    if (personal) {
      await db.run(sql`INSERT INTO book_transactions (transaction_id, workspace_id, book_id) VALUES (${transactionId}, ${ws.workspaceId}, ${personal})`);
      await captureRevaluingTx(db, transactionId);
    }
  }
  return true;
}
