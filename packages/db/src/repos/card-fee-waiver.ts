import { coveredCharge, type FeeWaiver, refundLines } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { categoryIdsByKeyTx } from './categories';
import { feeFieldsByCard } from './fee-columns';
import { postTransactionTx, voidTransactionTx } from './ledger';
import { cardSpendLines, PointsError } from './points';

/*
 * `card_fee_waivers` and `card_fee_refunds` (0106): how a card's annual fee gets waived, and a challenge's refund.
 * Read and written by name through raw SQL, like the other side tables, so a database stopped before 0106 only loses
 * the waiver and never fails to save a card.
 */

const seen = new WeakSet<object>();
async function tablesExist(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_fee_waivers'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

type WaiverRow = [string, string, number, string | null, string | null, string];
const toWaiver = ([, kind, amount, from, by, categories]: WaiverRow): FeeWaiver => ({
  kind: kind as FeeWaiver['kind'],
  amountMinor: Number(amount),
  countedFrom: from,
  spendBy: by,
  categoryIds: JSON.parse(categories) as string[],
});

/** Every card's waiver in the workspace, by account id. */
export async function listFeeWaivers(db: Db, ws: WorkspaceContext): Promise<Map<string, FeeWaiver>> {
  if (!(await tablesExist(db))) return new Map();
  const rows = await db.values<WaiverRow>(
    sql`SELECT account_id, kind, amount_minor, counted_from, spend_by, category_ids FROM card_fee_waivers WHERE workspace_id = ${ws.workspaceId}`,
  );
  return new Map(rows.map((row) => [row[0], toWaiver(row)]));
}

export async function getFeeWaiver(db: Db, ws: WorkspaceContext, accountId: string): Promise<FeeWaiver | null> {
  return (await listFeeWaivers(db, ws)).get(accountId) ?? null;
}

function check(waiver: FeeWaiver) {
  if (!(waiver.amountMinor > 0)) throw new PointsError('Enter the amount to spend');
  if (waiver.kind === 'challenge') {
    if (!waiver.countedFrom || !waiver.spendBy) throw new PointsError('Enter the day counting starts and the day to spend by');
    if (waiver.spendBy < waiver.countedFrom) throw new PointsError('The day to spend by is before the day counting starts');
  }
}

/** Whether card_fee_waivers has fee_year (0113). Once seen it is remembered: a column is never taken away. */
const yearSeen = new WeakSet<object>();
async function feeYearColumn(db: Db): Promise<boolean> {
  if (yearSeen.has(db)) return true;
  if ((await db.values(sql`SELECT 1 FROM pragma_table_info('card_fee_waivers') WHERE name = 'fee_year'`)).length === 0) return false;
  yearSeen.add(db);
  return true;
}

async function writeWaiver(db: Db, ws: WorkspaceContext, accountId: string, waiver: FeeWaiver, feeYear: number | null = null) {
  check(waiver);
  const challenge = waiver.kind === 'challenge';
  await db.run(
    sql`INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, counted_from, spend_by, category_ids, created_at)
        VALUES (${accountId}, ${ws.workspaceId}, ${waiver.kind}, ${waiver.amountMinor}, ${challenge ? waiver.countedFrom : null}, ${challenge ? waiver.spendBy : null}, ${JSON.stringify(waiver.categoryIds)}, ${new Date().toISOString()})
        ON CONFLICT (account_id) DO UPDATE SET kind = excluded.kind, amount_minor = excluded.amount_minor, counted_from = excluded.counted_from,
          spend_by = excluded.spend_by, category_ids = excluded.category_ids`,
  );
  if (await feeYearColumn(db)) await db.run(sql`UPDATE card_fee_waivers SET fee_year = ${challenge ? feeYear : null} WHERE account_id = ${accountId} AND workspace_id = ${ws.workspaceId}`);
}

/**
 * Sets a card's waiver, replacing the one it had. A challenge keeps the year of the fee it is for: the charge a waiver
 * covers on `today`, the day it is saved — a challenge the bank gives once the fee has posted is that fee's.
 */
export async function saveFeeWaiver(database: Database, ws: WorkspaceContext, accountId: string, waiver: FeeWaiver, today?: string): Promise<void> {
  if (!(await tablesExist(database.db))) throw new PointsError('This database needs updating before a fee waiver can be saved');
  await database.transaction(async (tx) => {
    const feeOn = (await feeFieldsByCard(tx, ws)).get(accountId)?.annualFeeOn ?? null;
    await writeWaiver(tx, ws, accountId, waiver, feeOn && today ? Number(coveredCharge(feeOn, today).slice(0, 4)) : null);
  });
}

/**
 * The year of the fee a card's challenge is for: the one kept when it was saved; for a challenge saved before that
 * was kept, the charge its last day covers (or, on a card with no fee date, its last day's year). Null without one.
 */
export async function challengeFeeYear(db: Db, ws: WorkspaceContext, accountId: string): Promise<number | null> {
  if (!(await tablesExist(db))) return null;
  const year = (await feeYearColumn(db)) ? sql`fee_year` : sql`NULL`;
  const [row] = await db.values<[string, string | null, number | null]>(
    sql`SELECT kind, spend_by, ${year} FROM card_fee_waivers WHERE account_id = ${accountId} AND workspace_id = ${ws.workspaceId}`,
  );
  if (!row || row[0] !== 'challenge' || !row[1]) return null;
  if (row[2] !== null) return Number(row[2]);
  const feeOn = (await feeFieldsByCard(db, ws)).get(accountId)?.annualFeeOn ?? null;
  return Number((feeOn ? coveredCharge(feeOn, row[1]) : row[1]).slice(0, 4));
}

export async function clearFeeWaiver(database: Database, ws: WorkspaceContext, accountId: string): Promise<void> {
  if (!(await tablesExist(database.db))) return;
  await database.db.run(sql`DELETE FROM card_fee_waivers WHERE account_id = ${accountId} AND workspace_id = ${ws.workspaceId}`);
}

export interface FeeRefund {
  transactionId: string;
  accountId: string;
  feeYear: number;
}

/**
 * The refunds of a card's annual fees that are still in force: each by the transaction that stands for it now, an
 * edit's replacement included (a refund edited before edits carried the link is found through what it replaced).
 */
export async function listFeeRefunds(db: Db, ws: WorkspaceContext, accountId?: string): Promise<FeeRefund[]> {
  if (!(await tablesExist(db))) return [];
  const rows = await db.values<[string, string, number]>(
    sql`WITH RECURSIVE chain(root, id) AS (
          SELECT transaction_id, transaction_id FROM card_fee_refunds WHERE workspace_id = ${ws.workspaceId} ${accountId ? sql`AND account_id = ${accountId}` : sql``}
          UNION SELECT chain.root, t.id FROM transactions t JOIN chain ON t.replaces_transaction_id = chain.id
        )
        SELECT t.id, r.account_id, r.fee_year FROM chain
        JOIN card_fee_refunds r ON r.transaction_id = chain.root
        JOIN transactions t ON t.id = chain.id AND t.status = 'posted'
        ORDER BY r.created_at`,
  );
  return rows.map(([transactionId, account, feeYear]) => ({ transactionId, accountId: account, feeYear: Number(feeYear) }));
}

/** Puts back a challenge a refund cleared (the old Fee refunded removed it), as it stood. */
export async function restoreWaiver(db: Db, ws: WorkspaceContext, accountId: string, waiver: FeeWaiver): Promise<void> {
  await writeWaiver(db, ws, accountId, waiver);
}

/**
 * What each of the account's plastic cards spent in the days given: the statement's purchase lines (card fees left
 * out, refunds taken off) summed by the card the purchase names (transactions.card_id). A purchase naming no card is
 * under the key ''.
 */
export async function spendByPlastic(database: Database, ws: WorkspaceContext, cardAccountId: string, from: string, to: string): Promise<Record<string, number>> {
  const lines = await cardSpendLines(database, ws, cardAccountId, from, to);
  const named = await database.db.values<[string, string]>(
    sql`SELECT t.id, t.card_id FROM transactions t WHERE t.workspace_id = ${ws.workspaceId} AND t.card_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${cardAccountId})`,
  );
  const cardOf = new Map(named);
  const out: Record<string, number> = {};
  for (const line of lines) {
    if (line.cardFee) continue;
    const key = cardOf.get(line.transactionId) ?? '';
    out[key] = (out[key] ?? 0) + line.amountMinor;
  }
  return out;
}
