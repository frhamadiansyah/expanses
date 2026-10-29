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

export const REFUND_DESCRIPTION = 'Annual fee refund';

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

async function writeWaiver(db: Db, ws: WorkspaceContext, accountId: string, waiver: FeeWaiver) {
  check(waiver);
  const challenge = waiver.kind === 'challenge';
  await db.run(
    sql`INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, counted_from, spend_by, category_ids, created_at)
        VALUES (${accountId}, ${ws.workspaceId}, ${waiver.kind}, ${waiver.amountMinor}, ${challenge ? waiver.countedFrom : null}, ${challenge ? waiver.spendBy : null}, ${JSON.stringify(waiver.categoryIds)}, ${new Date().toISOString()})
        ON CONFLICT (account_id) DO UPDATE SET kind = excluded.kind, amount_minor = excluded.amount_minor, counted_from = excluded.counted_from,
          spend_by = excluded.spend_by, category_ids = excluded.category_ids`,
  );
}

/** Sets a card's waiver, replacing the one it had. */
export async function saveFeeWaiver(database: Database, ws: WorkspaceContext, accountId: string, waiver: FeeWaiver): Promise<void> {
  if (!(await tablesExist(database.db))) throw new PointsError('This database needs updating before a fee waiver can be saved');
  await database.transaction(async (tx) => writeWaiver(tx, ws, accountId, waiver));
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

/** The refunds of a card's annual fees that are still in force (the receipt not taken back). */
export async function listFeeRefunds(db: Db, ws: WorkspaceContext, accountId?: string): Promise<FeeRefund[]> {
  if (!(await tablesExist(db))) return [];
  const rows = await db.values<[string, string, number]>(
    sql`SELECT r.transaction_id, r.account_id, r.fee_year FROM card_fee_refunds r JOIN transactions t ON t.id = r.transaction_id AND t.status = 'posted'
        WHERE r.workspace_id = ${ws.workspaceId} ${accountId ? sql`AND r.account_id = ${accountId}` : sql``} ORDER BY r.created_at`,
  );
  return rows.map(([transactionId, account, feeYear]) => ({ transactionId, accountId: account, feeYear: Number(feeYear) }));
}

/**
 * The bank refunded the fee a reached challenge was for. Posts "Annual fee refund" (+amount) into `intoAccountId`,
 * against the Membership fee category, linked to the challenge; the challenge is cleared. The fee's year is that of
 * the charge the card's fee date covers (the year received when the card has no fee date).
 */
export async function refundFeeChallenge(
  database: Database,
  ws: WorkspaceContext,
  input: { cardId: string; amountMinor: number; receivedOn: string; intoAccountId: string; today: string },
): Promise<{ transactionId: string }> {
  if (!(input.amountMinor > 0)) throw new PointsError('Enter the amount refunded');
  return database.transaction(async (tx) => {
    const challenge = (await listFeeWaivers(tx, ws)).get(input.cardId);
    if (!challenge || challenge.kind !== 'challenge') throw new PointsError('This card has no fee challenge');
    const [into] = await tx.select({ currency: accounts.currency }).from(accounts).where(and(eq(accounts.id, input.intoAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!into) throw new PointsError('Choose where the refund went');
    const keys = await categoryIdsByKeyTx(tx, ws);
    const category = keys['miscellaneous.membership_fee'] ?? keys['miscellaneous.fees_charges'];
    if (!category) throw new PointsError('The Membership fee category is missing');
    const feeOn = (await feeFieldsByCard(tx, ws)).get(input.cardId)?.annualFeeOn ?? null;
    const feeYear = Number((feeOn ? coveredCharge(feeOn, input.today) : input.receivedOn).slice(0, 4));
    const transactionId = await postTransactionTx(tx, ws, {
      occurredOn: input.receivedOn,
      description: REFUND_DESCRIPTION,
      lines: refundLines({ categoryAccountId: category, paymentAccountId: input.intoAccountId, amountMinor: input.amountMinor, currency: into.currency ?? ws.baseCurrency }),
    });
    await tx.run(
      sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
          VALUES (${transactionId}, ${ws.workspaceId}, ${input.cardId}, ${feeYear}, ${JSON.stringify(challenge)}, ${new Date().toISOString()})`,
    );
    await tx.run(sql`DELETE FROM card_fee_waivers WHERE account_id = ${input.cardId} AND workspace_id = ${ws.workspaceId}`);
    return { transactionId };
  });
}

/** Takes a refund back: the receipt is deleted and the challenge is put back as it was. */
export async function undoFeeRefund(database: Database, ws: WorkspaceContext, transactionId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [row] = await tx.values<[string, string]>(
      sql`SELECT account_id, challenge_json FROM card_fee_refunds WHERE transaction_id = ${transactionId} AND workspace_id = ${ws.workspaceId}`,
    );
    if (!row) throw new PointsError('That refund is not recorded');
    await voidTransactionTx(tx, ws, transactionId);
    await tx.run(sql`DELETE FROM card_fee_refunds WHERE transaction_id = ${transactionId}`);
    // A waiver set since is left alone: only an empty card gets its challenge back.
    if (!(await listFeeWaivers(tx, ws)).has(row[0])) await writeWaiver(tx, ws, row[0], JSON.parse(row[1]) as FeeWaiver);
  });
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
