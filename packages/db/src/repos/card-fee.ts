import { containsKeyword, coveredCharge, type FeeWaiver as FeeWaiverTerms, refundLines } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardTerms } from '../schema-points';
import { categoryIdsByKeyTx } from './categories';
import { challengeFeeYear, listFeeWaivers, restoreWaiver } from './card-fee-waiver';
import { feeColumnsExist, feeFieldsByCard, writeFeeFields } from './fee-columns';
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
/** How long after the date a bank's reversal of the fee is still looked for: the fee's own window and a cycle more. */
const REVERSAL_DAYS_AFTER = 120;

export const WAIVED_DESCRIPTION = 'Annual fee waived';
/** What money back for a fee the app never recorded is called (the old Fee refunded's name, kept). */
export const REFUND_DESCRIPTION = 'Annual fee refund';

/** A posted expense charge on the card near the fee date: one the annual fee may have been recorded as. */
export interface FeeChargeChoice {
  transactionId: string;
  occurredOn: string;
  description: string;
  /** What the charge cost, positive: its fee line's own amount on a split charge. */
  amountMinor: number;
  /** The category it was filed under, which the refund nets. */
  categoryId: string;
  /** Filed under a fee category or named like the annual fee. */
  looksLikeFee: boolean;
  /** The day a credit already recorded on the card reversed this charge, or null: such a charge is never refunded again. */
  reversedOn: string | null;
}

export interface FeeCharges {
  /** The charge a waiver covers. */
  covered: string;
  /**
   * The recorded charge Waived refunds unless another is picked: one that looks like the fee and is the card's fee
   * amount, is named like the annual fee, or is under Membership fee. Null when none is.
   */
  matched: FeeChargeChoice | null;
  /** Every posted expense charge on the card near the covered date, nearest first: what the fee can be picked from. */
  nearby: FeeChargeChoice[];
  /** The day a credit already recorded on the card reversed this fee (the matched charge, or the card's fee amount). */
  reversedOn: string | null;
}

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const isFeeKey = (key: string | null) => key !== null && FEE_KEYS.includes(key);
const isWorded = (description: string) => FEE_WORDS.some((word) => containsKeyword(description, word));
/** Within a percent: a reversal the bank posts for "roughly" the fee. */
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.round(b / 100));

type Row = { choice: FeeChargeChoice; categoryId: string; key: string | null; worded: boolean };

/**
 * The card's posted expense charges near `covered`, nearest first, one per transaction: a split charge is read by its
 * fee line (its own amount and category) when it has one, else by its first line. Each is marked with the credit on
 * the card that already reversed it, if any.
 */
async function chargesNear(tx: Db, ws: WorkspaceContext, cardId: string, covered: string, feeMinor: number | null): Promise<{ rows: Row[]; reversedOn: string | null }> {
  const rows = await tx.values<[string, string, string, number, string, string | null]>(sql`
    SELECT t.id, t.occurred_on, t.description, ce.amount_minor, ce.account_id, ca.system_key
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id AND t.status = 'posted'
    JOIN entries ce ON ce.transaction_id = t.id AND ce.account_id != e.account_id AND ce.amount_minor > 0
    JOIN accounts ca ON ca.id = ce.account_id AND ca.kind = 'expense'
    WHERE e.account_id = ${cardId} AND e.workspace_id = ${ws.workspaceId} AND e.amount_minor < 0
      AND t.occurred_on BETWEEN ${shift(covered, -DAYS_BEFORE)} AND ${shift(covered, DAYS_AFTER)}
      AND t.description != ${WAIVED_DESCRIPTION}
    ORDER BY ABS(julianday(t.occurred_on) - julianday(${covered})) ASC, t.occurred_on ASC, t.id ASC, ce.id ASC`);
  const byTransaction = new Map<string, Row>();
  for (const [id, occurredOn, description, amount, categoryId, key] of rows) {
    const seen = byTransaction.get(id);
    if (seen && !(isFeeKey(key) && !isFeeKey(seen.key))) continue;
    const worded = isWorded(description);
    byTransaction.set(id, { choice: { transactionId: id, occurredOn, description, amountMinor: Number(amount), categoryId, looksLikeFee: isFeeKey(key) || worded, reversedOn: null }, categoryId, key, worded });
  }
  const charges = [...byTransaction.values()];

  /*
   * Credits on the card that reverse a fee: in a fee category or named like the fee (an income line only by its
   * name), whatever they are called — a reversal typed in by hand as "Annual fee refund" counts. Only the refunds
   * Fee waived posted itself are left out, edited ones included.
   */
  const ours = await ourRefundIds(tx, cardId);
  const credits = (
    await tx.values<[string, string, string, number, string | null, string]>(sql`
      SELECT t.id, t.occurred_on, t.description, -ce.amount_minor, ca.system_key, ca.kind
      FROM entries e
      JOIN transactions t ON t.id = e.transaction_id AND t.status = 'posted'
      JOIN entries ce ON ce.transaction_id = t.id AND ce.account_id != e.account_id AND ce.amount_minor < 0
      JOIN accounts ca ON ca.id = ce.account_id AND ca.kind IN ('expense', 'income')
      WHERE e.account_id = ${cardId} AND e.workspace_id = ${ws.workspaceId} AND e.amount_minor > 0
        AND t.occurred_on BETWEEN ${shift(covered, -DAYS_BEFORE)} AND ${shift(covered, REVERSAL_DAYS_AFTER)}
      ORDER BY t.occurred_on ASC, t.id ASC`)
  ).filter(([id, , description, , key, kind]) => !ours.has(id) && (isWorded(description) || (kind === 'expense' && isFeeKey(key))));
  const used = new Set<string>();
  const take = (amountMinor: number, from: string) => {
    const credit = credits.find(([id, on, , amount]) => !used.has(id) && on >= from && near(Number(amount), amountMinor));
    if (!credit) return null;
    used.add(credit[0]);
    return credit[1];
  };
  // Fee-like charges first, so a reversal goes to the charge it is most likely for.
  for (const row of [...charges].sort((a, b) => Number(b.choice.looksLikeFee) - Number(a.choice.looksLikeFee))) row.choice.reversedOn = take(row.choice.amountMinor, row.choice.occurredOn);
  const matched = likeliest(charges, feeMinor);
  const reversedOn = matched ? matched.choice.reversedOn : feeMinor !== null ? take(feeMinor, shift(covered, -DAYS_BEFORE)) : null;
  return { rows: charges, reversedOn };
}

/**
 * The likeliest fee: a charge that looks like one (fee category or fee words) and is the card's fee amount, is named
 * like the annual fee, or is under Membership fee; the fee amount first, then the words, then the category, then the
 * nearest. Any other Fees & charges line (a stamp duty, a late fee) is offered in the list, never taken for the fee.
 */
function likeliest(rows: Row[], feeMinor: number | null): Row | null {
  const score = (row: Row) => (feeMinor !== null && row.choice.amountMinor === feeMinor ? 4 : 0) + (row.worded ? 2 : 0) + (row.key === 'miscellaneous.membership_fee' ? 1 : 0);
  let best: Row | null = null;
  for (const row of rows) if (row.choice.looksLikeFee && score(row) > 0 && (!best || score(row) > score(best))) best = row;
  return best;
}

async function feeTerms(tx: Db, ws: WorkspaceContext, cardId: string) {
  const fields = (await feeFieldsByCard(tx, ws)).get(cardId);
  const [row] = await tx.select({ annualFeeMinor: cardTerms.annualFeeMinor }).from(cardTerms).where(and(eq(cardTerms.accountId, cardId), eq(cardTerms.workspaceId, ws.workspaceId)));
  return { annualFeeOn: fields?.annualFeeOn ?? null, annualFeeWaivedYear: fields?.annualFeeWaivedYear ?? null, annualFeeMinor: row?.annualFeeMinor ?? null };
}

/**
 * What Fee waived would refund for the charge it covers now: the recorded charge that looks like the annual fee,
 * every expense charge on the card near that date to pick it from instead, and a reversal of the fee already on the
 * card. Nothing nearby means the fee was never recorded. Null on a card with no fee date.
 */
export async function annualFeeCharges(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<FeeCharges | null> {
  const terms = await feeTerms(database.db, ws, input.cardId);
  if (!terms.annualFeeOn) return null;
  const covered = coveredCharge(terms.annualFeeOn, input.today);
  const { rows, reversedOn } = await chargesNear(database.db, ws, input.cardId, covered, terms.annualFeeMinor);
  return { covered, matched: likeliest(rows, terms.annualFeeMinor)?.choice ?? null, nearby: rows.map((row) => row.choice), reversedOn };
}

/**
 * The day the card's annual fee is charged, set from Fee waived on a card that has none yet (a challenge set up before
 * the fee date was): the terms row is made when the card has none.
 */
export async function setAnnualFeeOn(database: Database, ws: WorkspaceContext, input: { cardId: string; annualFeeOn: string }): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.annualFeeOn)) throw new PointsError('Charged on must be a full date');
  await database.transaction(async (tx) => {
    const [card] = await tx.select({ subtype: accounts.subtype }).from(accounts).where(and(eq(accounts.id, input.cardId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
    if (!(await feeColumnsExist(tx))) throw new PointsError('This database needs updating before a fee date can be saved');
    await tx.insert(cardTerms).values({ accountId: input.cardId, workspaceId: ws.workspaceId, statementDay: null, dueDay: null, creditLimitMinor: null, annualFeeMinor: null }).onConflictDoNothing();
    await writeFeeFields(tx, ws, input.cardId, { annualFeeOn: input.annualFeeOn });
  });
}

/** The refunds Fee waived posted on the card (and the old Fee refunded), with every edit of them: never a reversal. */
async function ourRefundIds(tx: Db, cardId: string): Promise<Set<string>> {
  if (!(await hasRefundTable(tx))) return new Set();
  const rows = await tx.values<[string]>(sql`
    WITH RECURSIVE chain(id) AS (
      SELECT transaction_id FROM card_fee_refunds WHERE account_id = ${cardId}
      UNION SELECT t.id FROM transactions t JOIN chain ON t.replaces_transaction_id = chain.id
    )
    SELECT id FROM chain`);
  return new Set(rows.map(([id]) => id));
}

/** The charge a waiver is about: the covered one, or, on a card with no fee date, today (its year is the fee's). */
const coveredOf = (annualFeeOn: string | null, today: string) => (annualFeeOn ? coveredCharge(annualFeeOn, today) : today);

/** What came back for a waived fee: the refund posted, how much, the day, and the account it went to. */
export interface FeeBack {
  transactionId: string;
  amountMinor: number;
  on: string;
  /** The account the money came back to: the card, or, for an old Fee refunded, sometimes a bank account. */
  intoAccountId: string;
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
  /** The fee year the card's challenge is for, or null without one: Fee waived is offered on it only for this year. */
  challengeYear: number | null;
}

type RefundRow = { root: string | null; id: string; amountMinor: number; on: string; description: string; into: string };

async function hasRefundTable(tx: Db): Promise<boolean> {
  return (await tx.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_fee_refunds'`)).length > 0;
}

/**
 * The refunds posted for the year's fee. `linked`: those kept against the year (Fee waived, and the old Fee refunded),
 * each by the transaction that stands for it now — an edit's replacement, found through what it replaced when the
 * edit came before edits carried the link. `older`: an older Waived's refund, which kept no link: a posted "Annual fee
 * waived" on the card since the fee, that no kept refund stands for. Never an "Annual fee refund": one typed in by
 * hand has that name too, and the old Fee refunded always kept its link.
 */
async function refundsFor(tx: Db, ws: WorkspaceContext, cardId: string, year: number, covered: string): Promise<{ linked: RefundRow[]; older: RefundRow[] }> {
  if (!(await hasRefundTable(tx))) return { linked: [], older: [] };
  const amount = sql`(SELECT SUM(x.amount_minor) FROM entries x WHERE x.transaction_id = t.id AND x.amount_minor > 0)`;
  const into = sql`(SELECT x.account_id FROM entries x WHERE x.transaction_id = t.id AND x.amount_minor > 0 ORDER BY x.amount_minor DESC, x.id LIMIT 1)`;
  const chain = await tx.values<[string, string, number, string, string, string, string, number]>(sql`
    WITH RECURSIVE chain(root, id) AS (
      SELECT transaction_id, transaction_id FROM card_fee_refunds WHERE workspace_id = ${ws.workspaceId} AND account_id = ${cardId}
      UNION SELECT chain.root, t.id FROM transactions t JOIN chain ON t.replaces_transaction_id = chain.id
    )
    SELECT chain.root, t.id, ${amount}, t.occurred_on, t.description, ${into}, t.status, r.fee_year
    FROM chain JOIN transactions t ON t.id = chain.id JOIN card_fee_refunds r ON r.transaction_id = chain.root
    ORDER BY r.created_at, t.created_at`);
  const kept = new Set(chain.map((row) => row[1]));
  const linked = chain
    .filter(([, , , , , , status, feeYear]) => status === 'posted' && Number(feeYear) === year)
    .map(([root, id, amountMinor, on, description, account]) => ({ root, id, amountMinor: Number(amountMinor), on, description, into: account }));
  const older = (
    await tx.values<[string, number, string, string, string]>(sql`
      SELECT t.id, ${amount}, t.occurred_on, t.description, ${into} FROM transactions t
      WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND t.description = ${WAIVED_DESCRIPTION}
        AND t.occurred_on >= ${shift(covered, -DAYS_BEFORE)}
        AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${cardId})
      ORDER BY t.occurred_on`)
  )
    .filter(([id]) => !kept.has(id))
    .map(([id, amountMinor, on, description, account]) => ({ root: null, id, amountMinor: Number(amountMinor), on, description, into: account }));
  return { linked, older };
}

/**
 * This year's fee on the card: the charge covered, whether it is waived — by the mark Fee waived sets, or by a refund
 * kept for that year (the old Fee refunded set no mark) — and the refund that came back for it.
 */
export async function feeWaivedStatus(db: Db, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<FeeWaivedStatus> {
  const terms = await feeTerms(db, ws, input.cardId);
  const covered = coveredOf(terms.annualFeeOn, input.today);
  const year = Number(covered.slice(0, 4));
  const { linked, older } = await refundsFor(db, ws, input.cardId, year, covered);
  const marked = terms.annualFeeWaivedYear === year;
  const row = linked.at(-1) ?? (marked ? older.at(-1) : undefined);
  const back = row ? { transactionId: row.id, amountMinor: row.amountMinor, on: row.on, intoAccountId: row.into, cancelsCharge: row.description === WAIVED_DESCRIPTION } : null;
  return { year, covered, waived: marked || linked.length > 0, back, challengeYear: await challengeFeeYear(db, ws, input.cardId) };
}

export type FeeWaivedInput =
  | { cardId: string; today: string; back: false }
  | { cardId: string; today: string; back: true; cameBackOn: string; chargeId: string }
  | { cardId: string; today: string; back: true; cameBackOn: string; chargeId: null; amountMinor: number };

/**
 * The bank waived this year's annual fee: the one way it is recorded, from Settings, from a fee challenge and from
 * Recurring. The card needs its fee date first: it says which year is waived.
 *
 * - Back on the card, a fee charge recorded (`chargeId`, one of `annualFeeCharges`' nearby): a refund cancels that
 *   charge in its category, dated `cameBackOn` (never before the charge, never after today). A charge a credit on the
 *   card already reversed is refused.
 * - Back on the card, no charge recorded (`chargeId` null): the money coming back is recorded on the card in the
 *   Membership fee category, as the old Fee refunded did; a card at nothing goes into credit.
 * - Not back (`back` false): the fee was never charged, or its reversal is already recorded; only the year is marked.
 *
 * Every way marks the year waived, and a refund is kept against the year (card_fee_refunds), so Undo takes back
 * exactly what was written. A fee challenge is left on the card, to show it was met.
 */
export async function saveFeeWaived(database: Database, ws: WorkspaceContext, input: FeeWaivedInput): Promise<{ year: number; transactionId: string | null }> {
  return database.transaction(async (tx) => {
    const [card] = await tx.select({ subtype: accounts.subtype, currency: accounts.currency }).from(accounts).where(and(eq(accounts.id, input.cardId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
    const terms = await feeTerms(tx, ws, input.cardId);
    if (!terms.annualFeeOn) throw new PointsError('Set the day the fee is charged first.');
    const status = await feeWaivedStatus(tx, ws, input);
    if (status.waived) throw new PointsError(`The ${status.year} fee is already marked waived`);
    const { covered, year } = status;

    let transactionId: string | null = null;
    if (input.back) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.cameBackOn)) throw new PointsError('The day it came back is not a whole date');
      if (input.cameBackOn > input.today) throw new PointsError('The day it came back cannot be in the future');
      // A fee still ahead (waived in advance, within 30 days of it) has no charge to come after yet.
      if (input.cameBackOn < (covered < input.today ? covered : input.today)) throw new PointsError('The day it came back cannot be before the fee was charged');
      if (!(await hasRefundTable(tx))) throw new PointsError('This database needs updating before a fee can be waived');
      const currency = card.currency ?? ws.baseCurrency;
      if (input.chargeId !== null) {
        const fee = (await chargesNear(tx, ws, input.cardId, covered, terms.annualFeeMinor)).rows.find((row) => row.choice.transactionId === input.chargeId);
        if (!fee) throw new PointsError('That charge is not one of this card’s charges near the fee date');
        if (fee.choice.reversedOn) throw new PointsError(`A reversal of that charge is already recorded on ${fee.choice.reversedOn}`);
        const on = input.cameBackOn < fee.choice.occurredOn ? fee.choice.occurredOn : input.cameBackOn;
        if (on > input.today) throw new PointsError('The fee charge is dated after today, so its refund cannot be recorded yet');
        transactionId = await postTransactionTx(tx, ws, {
          occurredOn: on,
          description: WAIVED_DESCRIPTION,
          lines: refundLines({ categoryAccountId: fee.categoryId, paymentAccountId: input.cardId, amountMinor: fee.choice.amountMinor, currency }),
        });
      } else {
        if (!(input.amountMinor > 0)) throw new PointsError('Enter the amount that came back');
        const { reversedOn } = await chargesNear(tx, ws, input.cardId, covered, terms.annualFeeMinor);
        if (reversedOn) throw new PointsError(`A reversal of this fee is already recorded on ${reversedOn}.`);
        const keys = await categoryIdsByKeyTx(tx, ws);
        const category = keys['miscellaneous.membership_fee'] ?? keys['miscellaneous.fees_charges'];
        if (!category) throw new PointsError('The Membership fee category is missing');
        transactionId = await postTransactionTx(tx, ws, {
          occurredOn: input.cameBackOn,
          description: REFUND_DESCRIPTION,
          lines: refundLines({ categoryAccountId: category, paymentAccountId: input.cardId, amountMinor: input.amountMinor, currency }),
        });
      }
      // No challenge is kept with it: the challenge stays on the card (only the old Fee refunded cleared one).
      await tx.run(
        sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
            VALUES (${transactionId}, ${ws.workspaceId}, ${input.cardId}, ${year}, 'null', ${new Date().toISOString()})`,
      );
    }
    await writeFeeFields(tx, ws, input.cardId, { annualFeeWaivedYear: year });
    return { year, transactionId };
  });
}

/**
 * Takes back this year's waiver, whichever way it was recorded: the refunds kept for the year are voided as they stand
 * now (edited or not), and a challenge the old Fee refunded cleared is put back unless the card has a waiver again; an
 * older Waived's refund is voided too; and the year's mark is cleared.
 */
export async function undoFeeWaived(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<void> {
  await database.transaction(async (tx) => {
    const terms = await feeTerms(tx, ws, input.cardId);
    const covered = coveredOf(terms.annualFeeOn, input.today);
    const year = Number(covered.slice(0, 4));
    const marked = terms.annualFeeWaivedYear === year;
    const { linked, older } = await refundsFor(tx, ws, input.cardId, year, covered);
    for (const refund of linked) {
      const [kept] = await tx.values<[string]>(sql`SELECT challenge_json FROM card_fee_refunds WHERE transaction_id = ${refund.root}`);
      await voidTransactionTx(tx, ws, refund.id);
      await tx.run(sql`DELETE FROM card_fee_refunds WHERE transaction_id = ${refund.root}`);
      const challenge = kept ? (JSON.parse(kept[0]) as FeeWaiverTerms | null) : null;
      if (challenge && !(await listFeeWaivers(tx, ws)).has(input.cardId)) await restoreWaiver(tx, ws, input.cardId, challenge);
    }
    if (marked) for (const refund of older) await voidTransactionTx(tx, ws, refund.id);
    if (marked) await writeFeeFields(tx, ws, input.cardId, { annualFeeWaivedYear: null });
  });
}
