import {
  containsKeyword,
  coveredCharge,
  dayMonth,
  expenseLines,
  FEE_CHARGE_DESCRIPTION,
  FEE_DAYS_AFTER,
  FEE_DAYS_BEFORE,
  FEE_REVERSAL_DAYS_AFTER,
  FEE_REVERSAL_DESCRIPTION,
  type FeeWaiver as FeeWaiverTerms,
  type FeeYearLine,
  feeYearLines,
  type FeeYearState,
  feeYearState,
  refundLines,
} from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardTerms } from '../schema-points';
import { categoryIdsByKeyTx } from './categories';
import { challengeFeeYear, listFeeWaivers, restoreWaiver } from './card-fee-waiver';
import { feeFieldsByCard, writeFeeFields } from './fee-columns';
import { postTransactionTx, voidTransactionTx } from './ledger';
import { PointsError } from './points';

/** What a charge for the annual fee is called on a statement, in English and in Indonesian. */
const FEE_WORDS = ['annual fee', 'iuran tahunan', 'membership fee', 'annual membership', 'biaya tahunan', 'biaya kartu', 'iuran kartu'];
/** The categories an annual fee is filed under. */
const FEE_KEYS = ['miscellaneous.membership_fee', 'miscellaneous.fees_charges'];
/** How far from the fee date a recorded charge still counts as that year's fee, and how long its reversal is looked for (core). */
const DAYS_BEFORE = FEE_DAYS_BEFORE;
const DAYS_AFTER = FEE_DAYS_AFTER;
const REVERSAL_DAYS_AFTER = FEE_REVERSAL_DAYS_AFTER;

export const WAIVED_DESCRIPTION = 'Annual fee waived';
/** What the Fee waiver page names the fee charge and the reversal it adds (core's words, here for the repo's readers). */
export { FEE_CHARGE_DESCRIPTION, FEE_REVERSAL_DESCRIPTION };
/** What money back for a fee the app never recorded is called (the old Fee refunded's name, kept). */
export const REFUND_DESCRIPTION = 'Annual fee refund';

/** A posted expense charge on the card near the fee date: one the annual fee may have been recorded as. */
interface FeeChargeChoice {
  transactionId: string;
  occurredOn: string;
  description: string;
  /** What the charge cost, positive: its fee line's own amount on a split charge. */
  amountMinor: number;
  /** The category it was filed under, which a reversal nets. */
  categoryId: string;
  /** Filed under a fee category or named like the annual fee. */
  looksLikeFee: boolean;
  /** The day a credit already recorded on the card reversed this charge, or null. */
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
/** A credit on the card that reversed a fee: the transaction, its day and what came back. */
interface Credit {
  transactionId: string;
  on: string;
  amountMinor: number;
}

async function chargesNear(tx: Db, ws: WorkspaceContext, cardId: string, covered: string, feeMinor: number | null): Promise<{ rows: Row[]; reversedOn: string | null; reversal: Credit | null }> {
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
  /*
   * The page's own reversal ("Annual fee reversal") is that fee's money back whatever its amount: the other phone gets
   * it without its card_fee_refunds link, and the bank may reverse the fee without its tax. Any other credit is taken
   * by the amount, within a percent.
   */
  const take = (amountMinor: number | null, from: string): Credit | null => {
    const fits = ([id, on, description, amount]: (typeof credits)[number]) =>
      !used.has(id) && on >= from && (description === FEE_REVERSAL_DESCRIPTION || (amountMinor !== null && near(Number(amount), amountMinor)));
    const credit = credits.find((c) => fits(c) && c[2] === FEE_REVERSAL_DESCRIPTION) ?? credits.find(fits);
    if (!credit) return null;
    used.add(credit[0]);
    return { transactionId: credit[0], on: credit[1], amountMinor: Number(credit[3]) };
  };
  // The likeliest fee first, then the other fee-like charges: a reversal goes to the annual fee before a late fee
  // nearer the date can take it.
  const reversalOf = new Map<string, Credit>();
  const first = likeliest(charges, feeMinor);
  const rank = (row: Row) => (row === first ? 2 : row.choice.looksLikeFee ? 1 : 0);
  for (const row of [...charges].sort((a, b) => rank(b) - rank(a))) {
    const credit = take(row.choice.amountMinor, row.choice.occurredOn);
    row.choice.reversedOn = credit?.on ?? null;
    if (credit) reversalOf.set(row.choice.transactionId, credit);
  }
  const matched = first;
  const reversal = matched ? (reversalOf.get(matched.choice.transactionId) ?? null) : take(feeMinor, shift(covered, -DAYS_BEFORE));
  return { rows: charges, reversedOn: reversal?.on ?? null, reversal };
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

/** Whether card_fee_waived_years is there (0115). Once seen it is remembered: a table is never taken away. */
const yearsSeen = new WeakSet<object>();
async function waivedYearsTable(tx: Db): Promise<boolean> {
  if (yearsSeen.has(tx)) return true;
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'card_fee_waived_years'`)).length === 0) return false;
  yearsSeen.add(tx);
  return true;
}

/**
 * The fee years marked waived on the card, one mark per year (card_fee_waived_years, 0115, this phone's own), and the
 * year card_terms keeps (the latest), which a database before 0115 has alone.
 */
async function waivedYearsTx(tx: Db, ws: WorkspaceContext, cardId: string, latest: number | null): Promise<Set<number>> {
  const years = new Set<number>(latest !== null ? [latest] : []);
  if (await waivedYearsTable(tx)) {
    const rows = await tx.values<[number]>(sql`SELECT fee_year FROM card_fee_waived_years WHERE account_id = ${cardId} AND workspace_id = ${ws.workspaceId}`);
    for (const [year] of rows) years.add(Number(year));
  }
  return years;
}

/** Marks a year waived, or takes the mark off; card_terms keeps the latest year still marked, for the readers that read it. */
async function setWaivedYearTx(tx: Db, ws: WorkspaceContext, cardId: string, year: number, waived: boolean): Promise<void> {
  if (!(await waivedYearsTable(tx))) {
    // A database before 0115 keeps one year, as it did.
    await writeFeeFields(tx, ws, cardId, { annualFeeWaivedYear: waived ? year : null });
    return;
  }
  if (waived) {
    await tx.run(sql`INSERT INTO card_fee_waived_years (account_id, workspace_id, fee_year, created_at) VALUES (${cardId}, ${ws.workspaceId}, ${year}, ${new Date().toISOString()})
                     ON CONFLICT (account_id, fee_year) DO NOTHING`);
  } else {
    await tx.run(sql`DELETE FROM card_fee_waived_years WHERE account_id = ${cardId} AND workspace_id = ${ws.workspaceId} AND fee_year = ${year}`);
  }
  const [latest] = await tx.values<[number | null]>(sql`SELECT MAX(fee_year) FROM card_fee_waived_years WHERE account_id = ${cardId} AND workspace_id = ${ws.workspaceId}`);
  await writeFeeFields(tx, ws, cardId, { annualFeeWaivedYear: latest?.[0] ?? null });
}

/** A day as the app says it: "15 Oct", with its year when that is not today's ("2 Feb 2027"). */
const said = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? dayMonth(iso) : `${dayMonth(iso)} ${iso.slice(0, 4)}`);

async function feeTerms(tx: Db, ws: WorkspaceContext, cardId: string) {
  const fields = (await feeFieldsByCard(tx, ws)).get(cardId);
  const [row] = await tx.select({ annualFeeMinor: cardTerms.annualFeeMinor }).from(cardTerms).where(and(eq(cardTerms.accountId, cardId), eq(cardTerms.workspaceId, ws.workspaceId)));
  return { annualFeeOn: fields?.annualFeeOn ?? null, annualFeeWaivedYear: fields?.annualFeeWaivedYear ?? null, annualFeeMinor: row?.annualFeeMinor ?? null };
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
  /** The card has its fee date: without it, the year is today's and Fee waived asks for the date first. */
  dated: boolean;
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
async function refundsFor(tx: Db, ws: WorkspaceContext, cardId: string, year: number, covered: string, upTo: string | null = null): Promise<{ linked: RefundRow[]; older: RefundRow[] }> {
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
        AND t.occurred_on >= ${shift(covered, -DAYS_BEFORE)} ${upTo ? sql`AND t.occurred_on <= ${upTo}` : sql``}
        AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${cardId})
      ORDER BY t.occurred_on`)
  )
    .filter(([id]) => !kept.has(id))
    .map(([id, amountMinor, on, description, account]) => ({ root: null, id, amountMinor: Number(amountMinor), on, description, into: account }));
  return { linked, older };
}

/**
 * This year's fee on the card, read as the Fee waiver page reads it (`cardFeeYears`): waived once the year is marked or
 * money back for it is on the card — the app's own refund, or a reversal a statement check found — with what came
 * back. A card with no fee date reads today's year, by its marks and kept refunds alone.
 */
export async function feeWaivedStatus(db: Db, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<FeeWaivedStatus> {
  const terms = await feeTerms(db, ws, input.cardId);
  const covered = coveredOf(terms.annualFeeOn, input.today);
  const year = Number(covered.slice(0, 4));
  const { linked, older } = await refundsFor(db, ws, input.cardId, year, covered);
  const marks = await waivedYearsTx(db, ws, input.cardId, terms.annualFeeWaivedYear);
  const record = terms.annualFeeOn ? await feeYearTx(db, ws, input.cardId, terms, await cardStartsOn(db, ws, input.cardId), covered, true) : null;
  const marked = marks.has(year);
  const row = linked.at(-1) ?? (marked ? older.at(-1) : undefined);
  const found = record?.reversal && !record.reversal.ours ? record.reversal : null;
  const back = row
    ? { transactionId: row.id, amountMinor: row.amountMinor, on: row.on, intoAccountId: row.into, cancelsCharge: row.description === WAIVED_DESCRIPTION }
    : found
      ? { transactionId: found.transactionId, amountMinor: found.amountMinor, on: found.on, intoAccountId: input.cardId, cancelsCharge: record?.charge !== null }
      : null;
  const waived = record ? record.state === 'waived' : marked || linked.length > 0;
  return { year, covered, waived, back, challengeYear: await challengeFeeYear(db, ws, input.cardId), dated: terms.annualFeeOn !== null };
}

/**
 * Every card whose fee year now is waived, by the page's reading (`cardFeeYears`), with that year: Recurring leaves its
 * fee out of Due soon and names the charge after it.
 */
export async function waivedFeeYears(db: Db, ws: WorkspaceContext, today: string): Promise<Map<string, number>> {
  const cards = [...(await feeFieldsByCard(db, ws)).entries()].filter(([, fields]) => fields.annualFeeOn !== null);
  const out = new Map<string, number>();
  for (const [cardId] of cards) {
    const terms = await feeTerms(db, ws, cardId);
    const record = await feeYearTx(db, ws, cardId, terms, await cardStartsOn(db, ws, cardId), coveredCharge(terms.annualFeeOn!, today), true);
    if (record.state === 'waived') out.set(cardId, record.year);
  }
  return out;
}

export interface FeeWaivedInput {
  cardId: string;
  today: string;
  /** Kept for the callers that say so: the fee is waived with nothing back. */
  back: false;
}

/**
 * Waived, not charged: the bank skipped this year's fee. Only the year is marked (one mark per year); no money moves.
 * The card needs its fee date first: it says which year. Refused once the year reads waived, and once the charge is on
 * the card (that fee is reversed instead).
 */
export async function saveFeeWaived(database: Database, ws: WorkspaceContext, input: FeeWaivedInput): Promise<{ year: number; transactionId: null }> {
  return database.transaction(async (tx) => {
    const { terms, annualFeeOn } = await feeCardTx(tx, ws, input.cardId);
    const record = await feeYearTx(tx, ws, input.cardId, terms, await cardStartsOn(tx, ws, input.cardId), coveredCharge(annualFeeOn, input.today), true);
    if (record.state === 'waived') throw new PointsError(`The ${record.year} fee is already marked waived`);
    if (record.charge) throw new PointsError(`The ${record.year} fee charge is on the card: add its reversal instead`);
    await setWaivedYearTx(tx, ws, input.cardId, record.year, true);
    return { year: record.year, transactionId: null };
  });
}

/**
 * Takes back this year's waiver, whichever way it was recorded: the refunds kept for the year are voided as they stand
 * now (edited or not), and a challenge the old Fee refunded cleared is put back unless the card has a waiver again; an
 * older Waived's refund is voided too; and the year's mark is cleared.
 */
export async function undoFeeWaived(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string; year?: number }): Promise<void> {
  await database.transaction(async (tx) => {
    const terms = await feeTerms(tx, ws, input.cardId);
    const current = coveredOf(terms.annualFeeOn, input.today);
    // An earlier year (the Fee waiver page's year page) is that year's charge, and its unlinked refunds are looked for
    // only as long after it as a reversal is: never a later year's.
    const past = input.year !== undefined && input.year < Number(current.slice(0, 4));
    const covered = past && terms.annualFeeOn ? feeDateIn(terms.annualFeeOn, input.year!) : current;
    const year = Number(covered.slice(0, 4));
    const marked = (await waivedYearsTx(tx, ws, input.cardId, terms.annualFeeWaivedYear)).has(year);
    const { linked, older } = await refundsFor(tx, ws, input.cardId, year, covered, past ? shift(covered, REVERSAL_DAYS_AFTER) : null);
    for (const refund of linked) {
      const [kept] = await tx.values<[string]>(sql`SELECT challenge_json FROM card_fee_refunds WHERE transaction_id = ${refund.root}`);
      await voidTransactionTx(tx, ws, refund.id);
      await tx.run(sql`DELETE FROM card_fee_refunds WHERE transaction_id = ${refund.root}`);
      const challenge = kept ? (JSON.parse(kept[0]) as FeeWaiverTerms | null) : null;
      if (challenge && !(await listFeeWaivers(tx, ws)).has(input.cardId)) await restoreWaiver(tx, ws, input.cardId, challenge);
    }
    if (marked) for (const refund of older) await voidTransactionTx(tx, ws, refund.id);
    if (marked) await setWaivedYearTx(tx, ws, input.cardId, year, false);
  });
}

/*
 * The Fee waiver page (owner, 13 Nov 2026): each fee year read from the card's own transactions — the fee charge, the
 * money back for it, and the year's waived mark — and the two things it adds there, the charge and the reversal, both
 * on this card in Membership fee through the ledger.
 */

/** A transaction a fee year names: its day and its money. */
export interface FeeMoney {
  transactionId: string;
  on: string;
  amountMinor: number;
}

/** One fee year of a card, as the Fee waiver page shows it. */
export interface FeeYearRecord {
  year: number;
  /** The charge date this year covers. */
  covered: string;
  /** The fee charge on the card (a split charge by its fee line). */
  charge: FeeMoney | null;
  /** No charge is recorded and the charge date is before the card is counted from: it is in the starting balance. */
  beforeApp: boolean;
  /** Money back for the fee on the card. `ours`: one the app posted for it (kept in card_fee_refunds). */
  reversal: (FeeMoney & { ours: boolean }) | null;
  /** The year is marked waived. */
  marked: boolean;
  lines: FeeYearLine[];
  state: FeeYearState;
}

export interface CardFeeYears {
  /** The card's annual fee now; null when no amount is set. */
  feeMinor: number | null;
  /** The day the card is counted from: its opening entry's, else its As of day; null with neither. */
  startsOn: string | null;
  /** The fee year the page covers: the coming charge within 30 days, else the latest one that has passed. */
  current: FeeYearRecord;
  /** Past fee years with something recorded, newest first. */
  earlier: FeeYearRecord[];
}

/** How many past fee years are looked through at most. */
const EARLIER_YEARS = 10;

/** The fee's date in `year`; 29 Feb falls on 28 Feb in a year without one. */
function feeDateIn(chargedOn: string, year: number): string {
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  const day = chargedOn.slice(5) === '02-29' && !leap ? '02-28' : chargedOn.slice(5);
  return `${String(year).padStart(4, '0')}-${day}`;
}

/** The day the card is counted from: its opening entry's, else its As of day (0107); null with neither. */
async function cardStartsOn(tx: Db, ws: WorkspaceContext, cardId: string): Promise<string | null> {
  const [opening] = await tx.values<[string | null]>(sql`
    SELECT MIN(t.occurred_on) FROM transactions t
    JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${cardId}
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND EXISTS (SELECT 1 FROM entries o JOIN accounts oa ON oa.id = o.account_id
                  WHERE o.transaction_id = t.id AND oa.kind = 'equity' AND oa.system_key = 'opening_balance')`);
  if (opening?.[0]) return opening[0];
  if ((await tx.values(sql`SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'counted_from'`)).length === 0) return null;
  const [row] = await tx.values<[string | null]>(sql`SELECT counted_from FROM accounts WHERE id = ${cardId} AND workspace_id = ${ws.workspaceId}`);
  return row?.[0] ?? null;
}

type Terms = Awaited<ReturnType<typeof feeTerms>>;

/** One fee year: the charge near its date, the money back for it (the app's own first), and its mark. */
async function feeYearTx(tx: Db, ws: WorkspaceContext, cardId: string, terms: Terms, startsOn: string | null, covered: string, current: boolean): Promise<FeeYearRecord> {
  const year = Number(covered.slice(0, 4));
  const near = await chargesNear(tx, ws, cardId, covered, terms.annualFeeMinor);
  const matched = likeliest(near.rows, terms.annualFeeMinor);
  const charge = matched ? { transactionId: matched.choice.transactionId, on: matched.choice.occurredOn, amountMinor: matched.choice.amountMinor } : null;
  const marked = (await waivedYearsTx(tx, ws, cardId, terms.annualFeeWaivedYear)).has(year);
  // The current year reads an older Waived's unlinked refund as feeWaivedStatus does; an earlier one only within its own window.
  const { linked, older } = await refundsFor(tx, ws, cardId, year, covered, current ? null : shift(covered, REVERSAL_DAYS_AFTER));
  const ours = linked.at(-1) ?? (marked ? older.at(-1) : undefined);
  const reversal = ours ? { transactionId: ours.id, on: ours.on, amountMinor: ours.amountMinor, ours: true } : near.reversal ? { ...near.reversal, ours: false } : null;
  const beforeApp = !charge && startsOn !== null && covered < startsOn;
  const facts = { charged: charge !== null, beforeApp, reversed: reversal !== null, marked };
  return { year, covered, charge, beforeApp, reversal, marked, lines: feeYearLines(facts), state: feeYearState(facts) };
}

/**
 * A card's fee years for the Fee waiver page: the one it covers now and every earlier one with something recorded
 * (a charge, money back, or the waived mark), newest first, back to the year before the card is counted from. Nothing
 * is made up for a year the database holds nothing for. Null on a card with no fee date.
 */
export async function cardFeeYears(db: Db, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<CardFeeYears | null> {
  const terms = await feeTerms(db, ws, input.cardId);
  if (!terms.annualFeeOn) return null;
  const startsOn = await cardStartsOn(db, ws, input.cardId);
  const covered = coveredCharge(terms.annualFeeOn, input.today);
  const current = await feeYearTx(db, ws, input.cardId, terms, startsOn, covered, true);
  const coveredYear = current.year;
  const [first] = await db.values<[string | null]>(sql`
    SELECT MIN(t.occurred_on) FROM transactions t JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${input.cardId}
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'`);
  const since = startsOn ?? first?.[0] ?? null;
  const earlier: FeeYearRecord[] = [];
  if (since) {
    // A charge from the year before the card is counted from can still have its reversal on the card.
    const lowest = Math.max(Number(since.slice(0, 4)) - 1, coveredYear - EARLIER_YEARS);
    for (let year = coveredYear - 1; year >= lowest; year -= 1) {
      const record = await feeYearTx(db, ws, input.cardId, terms, startsOn, feeDateIn(terms.annualFeeOn, year), false);
      if (record.charge || record.reversal || record.marked) earlier.push(record);
    }
  }
  return { feeMinor: terms.annualFeeMinor, startsOn, current, earlier };
}

async function feeCardTx(tx: Db, ws: WorkspaceContext, cardId: string) {
  const [card] = await tx.select({ subtype: accounts.subtype, currency: accounts.currency }).from(accounts).where(and(eq(accounts.id, cardId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
  const terms = await feeTerms(tx, ws, cardId);
  if (!terms.annualFeeOn) throw new PointsError('Set the day the fee is charged first.');
  return { currency: card.currency ?? ws.baseCurrency, terms, annualFeeOn: terms.annualFeeOn };
}

function checkMoney(amountMinor: number, on: string, today: string) {
  if (!Number.isSafeInteger(amountMinor) || !(amountMinor > 0)) throw new PointsError('Enter the amount');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new PointsError('That is not a whole date');
  if (on > today) throw new PointsError('The date cannot be after today');
}

async function membershipFeeTx(tx: Db, ws: WorkspaceContext): Promise<string> {
  const keys = await categoryIdsByKeyTx(tx, ws);
  const category = keys['miscellaneous.membership_fee'] ?? keys['miscellaneous.fees_charges'];
  if (!category) throw new PointsError('The Membership fee category is missing');
  return category;
}

/**
 * Add the charge: the fee year's charge, not on the card yet, posted on the card in Membership fee as "Annual fee". It
 * counts as that month's spending. Refused when a charge is already there, when the year is marked waived, when the day
 * is after today, far from the fee date (so the year would not find it), or before the card is counted from (that
 * charge is in the starting balance).
 */
export async function addFeeCharge(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string; amountMinor: number; on: string }): Promise<string> {
  checkMoney(input.amountMinor, input.on, input.today);
  return database.transaction(async (tx) => {
    const { currency, terms, annualFeeOn } = await feeCardTx(tx, ws, input.cardId);
    const startsOn = await cardStartsOn(tx, ws, input.cardId);
    const record = await feeYearTx(tx, ws, input.cardId, terms, startsOn, coveredCharge(annualFeeOn, input.today), true);
    if (record.charge) throw new PointsError('The fee charge is already on the card');
    if (record.marked || record.reversal) throw new PointsError(`The ${record.year} fee is marked waived. Reset it first.`);
    const from = shift(record.covered, -DAYS_BEFORE);
    const to = shift(record.covered, DAYS_AFTER);
    if (input.on < from || input.on > to) throw new PointsError(`Pick a day from ${said(from, input.today)} to ${said(to, input.today)}`);
    if (startsOn !== null && input.on < startsOn) throw new PointsError('That day is before the card is counted from: the charge is in its starting balance');
    return postTransactionTx(tx, ws, {
      occurredOn: input.on,
      description: FEE_CHARGE_DESCRIPTION,
      lines: expenseLines({ categoryAccountId: await membershipFeeTx(tx, ws), paymentAccountId: input.cardId, amountMinor: input.amountMinor, currency }),
    });
  });
}

/**
 * Add reversal: money back for the fee year's charge, posted on the card as "Annual fee reversal" and kept against the
 * year (card_fee_refunds), which is what makes the year read waived.
 *
 * - With the charge on the card, it cancels that charge in the charge's own category.
 * - With the charge before the app (no charge row, the charge date before the card is counted from), it is the same
 *   money back in Membership fee, left out of reports: the card's balance rises, and that month's spending does not
 *   drop for a charge it never counted.
 *
 * Refused with no charge to reverse, with money back for the fee already on the card, before the charge, or after today.
 */
export async function addFeeReversal(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string; amountMinor: number; on: string }): Promise<string> {
  checkMoney(input.amountMinor, input.on, input.today);
  return database.transaction(async (tx) => {
    const { currency, terms, annualFeeOn } = await feeCardTx(tx, ws, input.cardId);
    if (!(await hasRefundTable(tx))) throw new PointsError('This database needs updating before a fee can be reversed');
    const startsOn = await cardStartsOn(tx, ws, input.cardId);
    const record = await feeYearTx(tx, ws, input.cardId, terms, startsOn, coveredCharge(annualFeeOn, input.today), true);
    if (record.reversal) throw new PointsError(`Money back for the ${record.year} fee is already on the card, on ${said(record.reversal.on, input.today)}`);
    let lines;
    if (record.charge) {
      if (input.on < record.charge.on) throw new PointsError(`The reversal cannot be before the charge, on ${said(record.charge.on, input.today)}`);
      if (input.amountMinor > record.charge.amountMinor) throw new PointsError('The reversal cannot be more than the charge');
      const near = await chargesNear(tx, ws, input.cardId, record.covered, terms.annualFeeMinor);
      const fee = near.rows.find((row) => row.choice.transactionId === record.charge!.transactionId);
      if (!fee) throw new PointsError('The fee charge is no longer on the card');
      lines = refundLines({ categoryAccountId: fee.categoryId, paymentAccountId: input.cardId, amountMinor: input.amountMinor, currency });
    } else if (record.beforeApp) {
      lines = refundLines({ categoryAccountId: await membershipFeeTx(tx, ws), paymentAccountId: input.cardId, amountMinor: input.amountMinor, currency });
    } else {
      throw new PointsError('Add the charge first: there is no fee charge on the card to reverse');
    }
    const id = await postTransactionTx(tx, ws, {
      occurredOn: input.on,
      description: FEE_REVERSAL_DESCRIPTION,
      lines,
      ...(record.charge ? {} : { excludedFromReport: true }),
    });
    await tx.run(
      sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
          VALUES (${id}, ${ws.workspaceId}, ${input.cardId}, ${record.year}, 'null', ${new Date().toISOString()})`,
    );
    return id;
  });
}
