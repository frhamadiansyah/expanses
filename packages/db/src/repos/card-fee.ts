import { containsKeyword, coveredCharge, type FeeWaiver as FeeWaiverTerms, refundLines } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardTerms } from '../schema-points';
import { categoryIdsByKeyTx } from './categories';
import { listFeeWaivers, restoreWaiver } from './card-fee-waiver';
import { feeFieldsByCard, writeFeeFields } from './fee-columns';
import { postTransactionTx, voidTransactionTx } from './ledger';
import { PointsError } from './points';

/** What a charge for the annual fee is called on a statement, in English and in Indonesian. */
const FEE_WORDS = ['annual fee', 'iuran tahunan', 'membership fee', 'annual membership', 'biaya tahunan', 'biaya kartu', 'iuran kartu'];
/** The categories an annual fee is filed under. */
const FEE_KEYS = ['miscellaneous.membership_fee', 'miscellaneous.fees_charges'];
/**
 * How far from the stored date a recorded charge still counts as that year's fee: a little before it, and up to the
 * statement after it, since a fee charged on the anniversary often posts only on the next statement.
 */
const DAYS_BEFORE = 20;
const DAYS_AFTER = 45;

export const WAIVED_DESCRIPTION = 'Annual fee waived';
/** What money back for a fee the app never recorded is called (the old Fee refunded's name, kept). */
export const REFUND_DESCRIPTION = 'Annual fee refund';


/** A posted expense charge on the card near the fee date: one the annual fee may have been recorded as. */
export interface FeeChargeChoice {
  transactionId: string;
  occurredOn: string;
  description: string;
  /** What the charge cost on the card, positive. */
  amountMinor: number;
  /** The category it was filed under, which the refund nets. */
  categoryId: string;
  /** Filed under a fee category or named like the annual fee. */
  looksLikeFee: boolean;
}

export interface FeeCharges {
  /** The charge a waiver covers. */
  covered: string;
  /** The recorded charge Waived refunds unless another is picked: the likeliest fee, or null when none looks like one. */
  matched: FeeChargeChoice | null;
  /** Every posted expense charge on the card near the covered date, nearest first: what the fee can be picked from. */
  nearby: FeeChargeChoice[];
}

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Row = { choice: FeeChargeChoice; categoryId: string; key: string | null; worded: boolean };

/** The card's posted expense charges near `covered`, nearest first, one per transaction (its first expense line's category). */
async function chargesNear(tx: Db, ws: WorkspaceContext, cardId: string, covered: string): Promise<Row[]> {
  const rows = await tx.values<[string, string, string, number, string, string | null]>(sql`
    SELECT t.id, t.occurred_on, t.description, e.amount_minor, ce.account_id, ca.system_key
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id AND t.status = 'posted'
    JOIN entries ce ON ce.transaction_id = t.id AND ce.account_id != e.account_id AND ce.amount_minor > 0
    JOIN accounts ca ON ca.id = ce.account_id AND ca.kind = 'expense'
    WHERE e.account_id = ${cardId} AND e.workspace_id = ${ws.workspaceId} AND e.amount_minor < 0
      AND t.occurred_on BETWEEN ${shift(covered, -DAYS_BEFORE)} AND ${shift(covered, DAYS_AFTER)}
      AND t.description != ${WAIVED_DESCRIPTION}
    ORDER BY ABS(julianday(t.occurred_on) - julianday(${covered})) ASC, t.occurred_on ASC, t.id ASC`);
  const byTransaction = new Map<string, Row>();
  for (const [id, occurredOn, description, amount, categoryId, key] of rows) {
    const worded = FEE_WORDS.some((word) => containsKeyword(description, word));
    const keyed = key !== null && FEE_KEYS.includes(key);
    const seen = byTransaction.get(id);
    // A split charge with a fee line is read by that line's category.
    if (seen && !(keyed && !(seen.key !== null && FEE_KEYS.includes(seen.key)))) continue;
    byTransaction.set(id, { choice: { transactionId: id, occurredOn, description, amountMinor: -amount, categoryId, looksLikeFee: keyed || worded }, categoryId, key, worded });
  }
  return [...byTransaction.values()];
}

/**
 * The likeliest fee among the charges that look like one: the card's own fee amount first, then one named like the
 * annual fee, then one under Membership fee, then the nearest. A stamp duty or late fee under Fees & charges near the
 * date is passed over for the charge that is the fee.
 */
function likeliest(rows: Row[], feeMinor: number | null): Row | null {
  const score = (row: Row) => (feeMinor !== null && row.choice.amountMinor === feeMinor ? 4 : 0) + (row.worded ? 2 : 0) + (row.key === 'miscellaneous.membership_fee' ? 1 : 0);
  let best: Row | null = null;
  for (const row of rows) if (row.choice.looksLikeFee && (!best || score(row) > score(best))) best = row;
  return best;
}

async function feeTerms(tx: Db, ws: WorkspaceContext, cardId: string) {
  const fields = (await feeFieldsByCard(tx, ws)).get(cardId);
  const [row] = await tx.select({ annualFeeMinor: cardTerms.annualFeeMinor }).from(cardTerms).where(and(eq(cardTerms.accountId, cardId), eq(cardTerms.workspaceId, ws.workspaceId)));
  return { annualFeeOn: fields?.annualFeeOn ?? null, annualFeeWaivedYear: fields?.annualFeeWaivedYear ?? null, annualFeeMinor: row?.annualFeeMinor ?? null };
}

/**
 * What Waived would refund for the charge it covers now: the recorded charge that looks like the annual fee, and every
 * expense charge on the card near that date to pick it from instead. Nothing nearby means the fee was never recorded.
 */
export async function annualFeeCharges(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<FeeCharges | null> {
  const terms = await feeTerms(database.db, ws, input.cardId);
  if (!terms.annualFeeOn) return null;
  const covered = coveredCharge(terms.annualFeeOn, input.today);
  const rows = await chargesNear(database.db, ws, input.cardId, covered);
  return { covered, matched: likeliest(rows, terms.annualFeeMinor)?.choice ?? null, nearby: rows.map((row) => row.choice) };
}

/** The charge a waiver is about: the covered one, or, on a card with no fee date, today (its year is the fee's). */
const coveredOf = (annualFeeOn: string | null, today: string) => (annualFeeOn ? coveredCharge(annualFeeOn, today) : today);

/** What came back on the card for a waived fee: the refund posted, how much, and the day. */
export interface FeeBack {
  transactionId: string;
  amountMinor: number;
  on: string;
  /** The refund cancels a recorded charge in its category (a fee in the app), rather than recording money back alone. */
  cancelsCharge: boolean;
}

/** How this year's fee stands: the charge a waiver covers, whether it was waived, and what came back for it. */
export interface FeeWaivedStatus {
  year: number;
  covered: string;
  waived: boolean;
  /** Null with nothing back: the fee was cancelled before it was charged, or waived before refunds were kept. */
  back: FeeBack | null;
}

/**
 * The refunds posted for the year's fee: those Fee waived recorded (and the old Fee refunded, which kept the same
 * record), then an older Waived's refund, which kept none: a posted "Annual fee waived" on the card since the fee.
 */
async function refundsFor(tx: Db, ws: WorkspaceContext, cardId: string, year: number, covered: string) {
  const amount = sql`(SELECT SUM(x.amount_minor) FROM entries x WHERE x.transaction_id = t.id AND x.amount_minor > 0)`;
  const linked = await tx.values<[string, number, string, string]>(sql`
    SELECT t.id, ${amount}, t.occurred_on, t.description FROM card_fee_refunds r JOIN transactions t ON t.id = r.transaction_id AND t.status = 'posted'
    WHERE r.workspace_id = ${ws.workspaceId} AND r.account_id = ${cardId} AND r.fee_year = ${year} ORDER BY r.created_at`);
  const older = await tx.values<[string, number, string, string]>(sql`
    SELECT t.id, ${amount}, t.occurred_on, t.description FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND t.description = ${WAIVED_DESCRIPTION}
      AND t.occurred_on >= ${shift(covered, -DAYS_BEFORE)}
      AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${cardId})
      AND NOT EXISTS (SELECT 1 FROM card_fee_refunds r WHERE r.transaction_id = t.id)
    ORDER BY t.occurred_on`);
  return { linked, older };
}

async function hasRefundTable(tx: Db): Promise<boolean> {
  return (await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_fee_refunds'`)).length > 0;
}

/**
 * This year's fee on the card: the charge covered, whether it is waived — by the mark Waived sets, or by a refund kept
 * for that year (the old Fee refunded set no mark) — and the refund that came back for it. Null with no fee date and
 * nothing recorded.
 */
export async function feeWaivedStatus(db: Db, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<FeeWaivedStatus> {
  const terms = await feeTerms(db, ws, input.cardId);
  const covered = coveredOf(terms.annualFeeOn, input.today);
  const year = Number(covered.slice(0, 4));
  const { linked, older } = (await hasRefundTable(db)) ? await refundsFor(db, ws, input.cardId, year, covered) : { linked: [], older: [] };
  const row = linked.at(-1) ?? older.at(-1);
  const back = row ? { transactionId: row[0], amountMinor: Number(row[1]), on: row[2], cancelsCharge: row[3] === WAIVED_DESCRIPTION } : null;
  return { year, covered, waived: terms.annualFeeWaivedYear === year || linked.length > 0, back };
}

export type FeeWaivedInput =
  | { cardId: string; today: string; back: false }
  | { cardId: string; today: string; back: true; cameBackOn: string; chargeId: string }
  | { cardId: string; today: string; back: true; cameBackOn: string; chargeId: null; amountMinor: number };

/**
 * The bank waived this year's annual fee: the one way it is recorded, from Settings, from a fee challenge and from
 * Recurring.
 *
 * - Back on the card, a fee charge recorded (`chargeId`, one of `annualFeeCharges`' nearby): a refund cancels that
 *   charge in its category, dated `cameBackOn` (never before the charge).
 * - Back on the card, no charge recorded (`chargeId` null): the money coming back is recorded on the card in the
 *   Membership fee category, as the old Fee refunded did; a card at nothing goes into credit.
 * - Not back (`back` false): the fee was never charged; only the year is marked.
 *
 * Every way marks the year waived, and a refund is kept against the year (card_fee_refunds), so Undo takes back
 * exactly what was written. A fee challenge is left on the card, to show it was met.
 */
export async function saveFeeWaived(database: Database, ws: WorkspaceContext, input: FeeWaivedInput): Promise<{ year: number; transactionId: string | null }> {
  return database.transaction(async (tx) => {
    const [card] = await tx.select({ subtype: accounts.subtype, currency: accounts.currency }).from(accounts).where(and(eq(accounts.id, input.cardId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
    const terms = await feeTerms(tx, ws, input.cardId);
    const status = await feeWaivedStatus(tx, ws, input);
    if (status.waived) throw new PointsError(`The ${status.year} fee is already marked waived`);
    const { covered, year } = status;

    let transactionId: string | null = null;
    if (input.back) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.cameBackOn)) throw new PointsError('The day it came back is not a whole date');
      if (input.cameBackOn > input.today) throw new PointsError('The day it came back cannot be in the future');
      // A fee still ahead (waived in advance, within 30 days of it) has no charge to come after yet.
      if (terms.annualFeeOn && input.cameBackOn < (covered < input.today ? covered : input.today)) throw new PointsError('The day it came back cannot be before the fee was charged');
      if (!(await hasRefundTable(tx))) throw new PointsError('This database needs updating before a fee can be waived');
      const currency = card.currency ?? ws.baseCurrency;
      if (input.chargeId !== null) {
        const fee = terms.annualFeeOn ? (await chargesNear(tx, ws, input.cardId, covered)).find((row) => row.choice.transactionId === input.chargeId) : undefined;
        if (!fee) throw new PointsError('That charge is not one of this card’s charges near the fee date');
        transactionId = await postTransactionTx(tx, ws, {
          occurredOn: input.cameBackOn < fee.choice.occurredOn ? fee.choice.occurredOn : input.cameBackOn,
          description: WAIVED_DESCRIPTION,
          lines: refundLines({ categoryAccountId: fee.categoryId, paymentAccountId: input.cardId, amountMinor: fee.choice.amountMinor, currency }),
        });
      } else {
        if (!(input.amountMinor > 0)) throw new PointsError('Enter the amount that came back');
        const keys = await categoryIdsByKeyTx(tx, ws);
        const category = keys['miscellaneous.membership_fee'] ?? keys['miscellaneous.fees_charges'];
        if (!category) throw new PointsError('The Membership fee category is missing');
        transactionId = await postTransactionTx(tx, ws, {
          occurredOn: input.cameBackOn,
          description: REFUND_DESCRIPTION,
          lines: refundLines({ categoryAccountId: category, paymentAccountId: input.cardId, amountMinor: input.amountMinor, currency }),
        });
      }
      const challenge = (await listFeeWaivers(tx, ws)).get(input.cardId);
      await tx.run(
        sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
            VALUES (${transactionId}, ${ws.workspaceId}, ${input.cardId}, ${year}, ${JSON.stringify(challenge ?? null)}, ${new Date().toISOString()})`,
      );
    }
    if (terms.annualFeeOn) await writeFeeFields(tx, ws, input.cardId, { annualFeeWaivedYear: year });
    return { year, transactionId };
  });
}

/**
 * Takes back this year's waiver, whichever way it was recorded: the refunds kept for the year are voided (and a
 * challenge the old Fee refunded cleared is put back, unless the card has a waiver again), an older Waived's refund is
 * voided too, and the year's mark is cleared.
 */
export async function undoFeeWaived(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<void> {
  await database.transaction(async (tx) => {
    const terms = await feeTerms(tx, ws, input.cardId);
    const covered = coveredOf(terms.annualFeeOn, input.today);
    const year = Number(covered.slice(0, 4));
    if (await hasRefundTable(tx)) {
      const { linked, older } = await refundsFor(tx, ws, input.cardId, year, covered);
      for (const [id] of linked) {
        const [kept] = await tx.values<[string]>(sql`SELECT challenge_json FROM card_fee_refunds WHERE transaction_id = ${id}`);
        await voidTransactionTx(tx, ws, id);
        await tx.run(sql`DELETE FROM card_fee_refunds WHERE transaction_id = ${id}`);
        const challenge = kept ? (JSON.parse(kept[0]) as FeeWaiverTerms | null) : null;
        if (challenge && !(await listFeeWaivers(tx, ws)).has(input.cardId)) await restoreWaiver(tx, ws, input.cardId, challenge);
      }
      if (terms.annualFeeWaivedYear === year) for (const [id] of older) await voidTransactionTx(tx, ws, id);
    }
    if (terms.annualFeeWaivedYear === year) await writeFeeFields(tx, ws, input.cardId, { annualFeeWaivedYear: null });
  });
}
