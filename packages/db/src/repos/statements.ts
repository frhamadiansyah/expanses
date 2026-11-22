import { coverStatement, type Cycle, installmentSchedule, nextStatementStart, type PoolLine, statementCycleFor, transferLines } from '@expanses/core';
import { cardOpeningOfTx, PLAN_OWED_REF } from './plan-owed';
import { cardInstallments } from '../schema-loans';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, transactions } from '../schema';
import { cardPostings, cardSettlements } from '../schema-cards';
import { cardTerms } from '../schema-points';
import { splitBooksOfMany } from './book-splits';
import { listInstallmentsTx } from './installments';
import { FEE_BEFORE_APP_REF, postTransactionTx } from './ledger';
import { feeReversalIds } from './fee-left-out';
import type { SetAsideChoice } from './set-aside-tx';

export class StatementError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'POSTED_BEFORE_PURCHASE' | 'INVALID_DATE' | 'NO_STATEMENT_DAY' | 'NOTHING_TO_PAY' | 'NOT_A_CHARGE' | 'ALREADY_PAID' | 'CURRENCY' | 'INVALID_AMOUNT' | 'STALE_AMOUNT',
    message: string,
  ) {
    super(message);
    this.name = 'StatementError';
  }
}

/** One row of a card statement: a transaction, or one month of an instalment plan. */
export interface StatementLine {
  /** Unique within the statement: the transaction's id, or the plan's id and instalment number. */
  key: string;
  /** The transaction, or for an instalment the purchase it was converted from. */
  transactionId: string;
  occurredOn: string;
  /** The bank's posting date, when the owner gave one. */
  postedOn: string | null;
  /** The date that decides the statement: the posting date when there is one, otherwise the purchase date. */
  statementOn: string;
  description: string;
  cardId: string | null;
  /** What it added to the card's ledger balance: positive for a charge, negative for a payment or refund. */
  owedMinor: number;
  /**
   * What it adds to the statement. A purchase converted to instalments counts nothing here; its instalments
   * count instead, one a month, the way the bank bills it. Everything else counts what it added to the balance.
   */
  countedMinor: number;
  /**
   * For an instalment row: which plan, which of its months, how the plan counts its spending (0120) and the category of
   * the purchase it came from (its largest category line), for the row's icon and name.
   */
  instalment: {
    planId: string;
    number: number;
    of: number;
    countMode?: 'at_purchase' | 'each_month';
    categoryId?: string | null;
    /**
     * A plan with no purchase (its purchase is not in the app): its row's `transactionId` is the line it is billed out
     * of — the plan's owed line, or the card's opening balance — not a purchase: nothing to open or assign. Its ✓ is the
     * plan's list's: ticked, it and every one before it are paid (`setPlanPaidSoFar`).
     */
    noPurchase?: true;
    /** For such a row: how many of the plan's instalments are paid, so the latest ticked one can be unticked. */
    paidSoFar?: number;
  } | null;
  /** For a purchase converted to instalments: the plan it became. */
  convertedTo: { planId: string; months: number } | null;
  /** A purchase or refund, as opposed to money moved onto the card. */
  spending: boolean;
  /** An investment bought with the card (a bond, a stock, a fund): a charge on the card, never spending. */
  trade?: true;
  /** The currency and amount the merchant charged, when the card converted it. */
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  /** The payment that was made for this purchase, while that payment stands. */
  paidBy: { transactionId: string; paidOn: string } | null;
  /** For a payment: how many purchases were ticked off when it was made. Zero for everything else. */
  settles: number;
  /** A purchase recorded as already paid off before the app: its balancing settlement stands beside it. */
  paidOff: boolean;
  /**
   * The balancing settlement of such a purchase. It counts in the totals, so the card stays even, but a statement
   * does not draw it: the purchase carries the mark instead.
   */
  balancing: boolean;
  /**
   * A plan's owed line (0124): the plan it holds the owed rest of. Not drawn, like a balancing settlement: the plan's
   * instalment rows bill it a month at a time.
   */
  owedOf?: string;
  /**
   * A purchase split across workspaces (0084) is one line, the whole charge as the bank prints it; these are its parts'
   * categories, largest first, for the line to name ("Groceries · Office supplies"). Absent on any other line.
   */
  splitCategories?: string[];
  /**
   * An annual fee's money back, or the fee row the app added beside a fee reversed before the app (owner, 22 Nov 2026):
   * shown settled (the paid ✓, "Settled") on its own, with no mark to give or take back. The money back still counts
   * and is used as credit like any refund; the added fee row and its settlement count nothing (they net to nothing),
   * so no total, cover or "N of M paid" changes for them.
   */
  feeSettled?: true;
}

export interface CardStatement {
  cycle: Cycle;
  currency: string;
  openingMinor: number;
  chargesMinor: number;
  /** Payments and refunds in the cycle, as a positive amount. */
  creditsMinor: number;
  closingMinor: number;
  /** Charges and credits whose statement date falls in the cycle, oldest first. */
  lines: StatementLine[];
  /** The statement date has passed. */
  closed: boolean;
  /** Payments and refunds after the statement date, up to today. Only for a closed statement. */
  paidSinceMinor: number;
  /** What is still owed from this statement, once it is closed. */
  leftToPayMinor: number | null;
  /**
   * The credits `paidSinceMinor` adds up (payments and money back after the statement date, up to today), oldest
   * first, without the balancing settlements no statement draws. Empty for an open statement.
   */
  laterCredits: StatementLine[];
  /**
   * What the card's payments cover of each charge on the statement that is not settled on its own, by line key, oldest
   * first (`statementCoverOf`). Worked out, never stored: deleting a payment makes its purchases owed again.
   */
  cover: Record<string, StatementCover>;
}

/** How much of one charge the card's payments cover, and which credit (a line key, in `lines` or `laterCredits`) completed it. */
export interface StatementCover {
  coveredMinor: number;
  leftMinor: number;
  whole: boolean;
  /** Null when nothing covers it yet, or the cover came from credit left on the card from before. */
  creditKey: string | null;
  /** How many credits went into its cover (credit carried from before counts none). */
  credits: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The ref a purchase's paid-off-before-the-app settlement carries (ledger's `beforeAppRef`). */
const BEFORE_APP = 'before-app:';

async function cardLines(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  const rows = await db.values<[string, string, string | null, string, string | null, number, number, string | null, string | null, string | null, number | null, number, string | null, number]>(sql`
    SELECT t.id, t.occurred_on, p.posted_on, t.description, t.card_id,
      -SUM(e.amount_minor),
      EXISTS (SELECT 1 FROM entries x JOIN accounts xa ON xa.id = x.account_id WHERE x.transaction_id = t.id AND xa.kind IN ('expense', 'income'))
        OR EXISTS (SELECT 1 FROM entries y WHERE y.transaction_id = t.id AND y.spend_category_id IS NOT NULL),
      pay.id, pay.occurred_on, t.original_currency, t.original_amount_minor,
      (SELECT COUNT(*) FROM card_settlements cs WHERE cs.payment_transaction_id = t.id),
      t.external_ref,
      EXISTS (SELECT 1 FROM investment_trades it WHERE it.transaction_id = t.id)
    FROM transactions t
    JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${cardAccountId}
    LEFT JOIN card_postings p ON p.transaction_id = t.id
    LEFT JOIN card_settlements s ON s.purchase_transaction_id = t.id
    LEFT JOIN transactions pay ON pay.id = s.payment_transaction_id AND pay.status = 'posted'
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
    GROUP BY t.id
  `);
  // A purchase split across workspaces names its parts' categories (0084): one query for every split on the card. So
  // does one with a part counted in no workspace, which names that part "Not counted".
  const splits = await splitBooksOfMany(db, rows.map((row) => row[0]));
  const notCounted = rows.length
    ? await db.values<[string]>(sql`
        SELECT DISTINCT e.transaction_id FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.account_id IN (SELECT id FROM accounts WHERE kind = 'equity' AND system_key = 'not_counted') AND e.transaction_id IN ${rows.map((row) => row[0])}`)
    : [];
  const parted = new Set([...splits.keys(), ...notCounted.map(([id]) => id)]);
  const partNames = new Map<string, string[]>();
  if (parted.size > 0) {
    const parts = await db.values<[string, string]>(sql`
      SELECT e.transaction_id, a.name FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id IN ${[...parted]} AND (a.kind IN ('expense', 'income') OR (a.kind = 'equity' AND a.system_key = 'not_counted'))
      ORDER BY ABS(e.amount_minor) DESC, e.rowid`);
    for (const [transactionId, name] of parts) partNames.set(transactionId, [...(partNames.get(transactionId) ?? []), name]);
  }
  const settled = new Set(rows.flatMap((row) => (row[12]?.startsWith(BEFORE_APP) ? [row[12].slice(BEFORE_APP.length)] : [])));
  // The fee rows the app added for fees reversed before the app, and their settlements: they net to nothing on the card.
  const feePairs = new Set(rows.flatMap((row) => (row[12]?.startsWith(FEE_BEFORE_APP_REF) ? [row[0]] : [])));
  const netsNothing = (id: string, ref: string | null) => feePairs.has(id) || (ref?.startsWith(BEFORE_APP) === true && feePairs.has(ref.slice(BEFORE_APP.length)));
  return rows
    .map(([transactionId, occurredOn, postedOn, description, cardId, owed, spending, paymentId, paidOn, originalCurrency, originalAmount, settles, ref, trade]) => ({
      transactionId,
      occurredOn,
      postedOn,
      statementOn: postedOn ?? occurredOn,
      description,
      cardId,
      key: transactionId,
      owedMinor: Number(owed),
      countedMinor: netsNothing(transactionId, ref) ? 0 : Number(owed),
      instalment: null,
      convertedTo: null,
      spending: Boolean(spending),
      originalCurrency,
      originalAmountMinor: originalAmount === null ? null : Number(originalAmount),
      paidBy: paymentId && paidOn ? { transactionId: paymentId, paidOn } : null,
      settles: Number(settles),
      paidOff: settled.has(transactionId),
      balancing: (ref?.startsWith(BEFORE_APP) || ref?.startsWith(PLAN_OWED_REF)) ?? false,
      ...(ref?.startsWith(PLAN_OWED_REF) ? { owedOf: ref.slice(PLAN_OWED_REF.length) } : {}),
      ...(partNames.has(transactionId) ? { splitCategories: partNames.get(transactionId)! } : {}),
      ...(Number(trade) === 1 ? { trade: true as const } : {}),
      ...(feePairs.has(transactionId) ? { feeSettled: true as const } : {}),
    }))
    .sort((a, b) => a.statementOn.localeCompare(b.statementOn) || a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId));
}

/**
 * The card's lines as the bank bills them: a purchase converted to a plan stays in its place but counts nothing,
 * and each instalment is a row on the statement it is billed on. A plan tied to a purchase no longer on the card has
 * no rows; one with no purchase bills its months out of its owed line (`noPurchaseLinesTx`).
 */
async function billedLines(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  const lines = await cardLines(db, ws, cardAccountId);
  const [terms] = await db
    .select({ statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  const byTransaction = new Map(lines.map((line) => [line.transactionId, line]));
  const instalments: StatementLine[] = [];
  const plans = await listInstallmentsTx(db, ws, cardAccountId);
  const categoryOf = await largestCategoryOf(db, plans.flatMap((plan) => (plan.transactionId && byTransaction.has(plan.transactionId) ? [plan.transactionId] : [])));
  for (const plan of plans) {
    const purchase = plan.transactionId ? byTransaction.get(plan.transactionId) : undefined;
    if (!purchase) continue;
    purchase.convertedTo = { planId: plan.id, months: plan.months };
    purchase.countedMinor = 0;
    for (const bill of installmentSchedule(plan, terms?.statementDay ?? 1)) {
      instalments.push({
        key: `${plan.id}#${bill.number}`,
        transactionId: purchase.transactionId,
        occurredOn: bill.statementOn,
        postedOn: null,
        statementOn: bill.statementOn,
        description: plan.description,
        cardId: purchase.cardId,
        owedMinor: bill.amountMinor,
        countedMinor: bill.amountMinor,
        instalment: { planId: plan.id, number: bill.number, of: plan.months, countMode: plan.countMode, categoryId: categoryOf.get(purchase.transactionId) ?? null },
        convertedTo: null,
        spending: true,
        originalCurrency: null,
        originalAmountMinor: null,
        paidBy: null,
        settles: 0,
        paidOff: false,
        balancing: false,
      });
    }
  }
  await noPurchaseLinesTx(db, ws, cardAccountId, plans, lines, instalments, terms?.statementDay ?? 1);
  return [...lines, ...instalments].sort(
    (a, b) => a.statementOn.localeCompare(b.statementOn) || a.occurredOn.localeCompare(b.occurredOn) || a.key.localeCompare(b.key),
  );
}

/**
 * The statement rows of plans with no purchase (owner, 17 Nov 2026: one plain rule): such a plan's purchase is not in the
 * app, but the bank bills each of its months, so every instalment is a row on its own statement. Those paid
 * (`paidSoFar`) say so and add nothing to what is due; the rest are billed and due like any line, and paid as the card's
 * payments cover them. In either Count spending mode: what the bank bills does not change with how it counts.
 *
 * What keeps nothing counted twice: the owed rest is already on the card's balance, in the plan's owed line — or, on a
 * card with an opening balance of its own, inside that opening (what the bank said was owed, the plan's unbilled months
 * included). That line counts less on the statements by the instalments still owed (never more than it holds), and each
 * counts on its own statement instead. Over the plan's months they add back to it, so the statements end where the
 * card's balance is, and what a statement asks (closing, due, cover) is what the bank bills. The balance, net worth and
 * the ledger are never touched by this.
 */
async function noPurchaseLinesTx(
  db: Db,
  ws: WorkspaceContext,
  cardAccountId: string,
  plans: Awaited<ReturnType<typeof listInstallmentsTx>>,
  lines: StatementLine[],
  instalments: StatementLine[],
  statementDay: number,
): Promise<void> {
  const unlinked = plans.filter((plan) => !plan.transactionId);
  if (unlinked.length === 0) return;
  const openingRow = await cardOpeningOfTx(db, ws, cardAccountId);
  const opening = openingRow ? lines.find((line) => line.transactionId === openingRow.id) : undefined;
  for (const plan of unlinked) {
    // What the owed instalments are billed out of: the plan's owed line, else the card's own opening balance.
    const holder = lines.find((line) => line.owedOf === plan.id) ?? opening;
    let owed = 0;
    for (const bill of installmentSchedule(plan, statementDay)) {
      const paid = bill.number <= plan.paidSoFar;
      if (!paid) owed += bill.amountMinor;
      instalments.push({
        key: `${plan.id}#${bill.number}`,
        transactionId: holder?.transactionId ?? '',
        occurredOn: bill.statementOn,
        postedOn: null,
        statementOn: bill.statementOn,
        description: plan.description,
        cardId: null,
        owedMinor: bill.amountMinor,
        countedMinor: paid ? 0 : bill.amountMinor,
        instalment: { planId: plan.id, number: bill.number, of: plan.months, countMode: plan.countMode, categoryId: plan.categoryAccountId, noPurchase: true, paidSoFar: plan.paidSoFar },
        convertedTo: null,
        spending: true,
        originalCurrency: null,
        originalAmountMinor: null,
        paidBy: null,
        settles: 0,
        paidOff: paid,
        balancing: false,
      });
    }
    if (holder && holder.countedMinor > 0) holder.countedMinor -= Math.min(holder.countedMinor, owed);
  }
}

/** Each purchase's largest category line, by transaction: what an instalment row is named and drawn by. */
async function largestCategoryOf(db: Db, transactionIds: readonly string[]): Promise<Map<string, string>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await db.values<[string, string]>(sql`
    SELECT e.transaction_id, e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE a.kind = 'expense' AND e.transaction_id IN ${[...transactionIds]}
    ORDER BY ABS(e.amount_minor) DESC, e.rowid`);
  const out = new Map<string, string>();
  for (const [transactionId, accountId] of rows) if (!out.has(transactionId)) out.set(transactionId, accountId);
  return out;
}

/** Every line the card has ever had, as statements bill them, for searching across statements. */
export async function cardStatementLines(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  return withFeeReversals(database, ws, (await billedLines(database.db, ws, cardAccountId)).filter((line) => !line.balancing));
}

/** Marks each annual fee reversal settled on its own (`feeSettled`), as the Fee waiver page reads them. Only how it shows. */
async function withFeeReversals(database: Database, ws: WorkspaceContext, lines: StatementLine[]): Promise<StatementLine[]> {
  const reversals = await feeReversalIds(database, ws);
  if (reversals.size === 0) return lines;
  return lines.map((line) => (reversals.has(line.transactionId) && !line.instalment && line.owedMinor < 0 ? { ...line, feeSettled: true as const } : line));
}

/** A payment onto a card, as the statement's paid ✓ names it: how much went onto the card, and where it came from. */
export interface CardPaymentSource {
  amountMinor: number;
  /** The account the money left, the largest when there were several; null for none (money back, an adjustment). */
  fromName: string | null;
}

/**
 * How much a payment put onto the card, and from which account, for the bubble a paid ✓ opens ("Rp 9.498.000 from BCA
 * Tahapan"). Null when the transaction put nothing onto this card, or is not posted.
 */
export async function cardPaymentSource(database: Database, ws: WorkspaceContext, cardAccountId: string, paymentTransactionId: string): Promise<CardPaymentSource | null> {
  const onCard = await database.db.values<[number | null]>(sql`
    SELECT SUM(e.amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id
    WHERE t.id = ${paymentTransactionId} AND t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND e.account_id = ${cardAccountId}`);
  const amountMinor = Number(onCard[0]?.[0] ?? 0);
  if (amountMinor <= 0) return null;
  const from = await database.db.values<[string]>(sql`
    SELECT a.name FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.transaction_id = ${paymentTransactionId} AND e.account_id <> ${cardAccountId} AND e.amount_minor < 0 AND a.kind IN ('asset', 'liability')
    ORDER BY e.amount_minor, e.rowid LIMIT 1`);
  return { amountMinor, fromName: from[0]?.[0] ?? null };
}

/**
 * Whether a line can carry the paid-off mark (`setSettledBeforeApp`), or already does: a purchase there is still
 * something to pay for, or money back (a refund) whose credit was used up — left standing, it would sit on the card as
 * a credit for ever. Never a payment, a purchase a recorded payment settled, an instalment row or a purchase converted
 * to a plan. One answer for the statement's swipe, its ⋯ and the receipt's switch.
 */
export function carriesPaidOffMark(line: StatementLine): boolean {
  // An annual fee's money back, and the fee row added beside one before the app, are settled on their own: a mark there
  // would post a settlement and change what the card owes.
  return line.spending && line.owedMinor !== 0 && !line.paidBy && !line.instalment && !line.convertedTo && !line.feeSettled;
}

/** The receipt's question about one transaction: a refund rather than a purchase, and whether the mark stands. */
export interface PaidOffMark {
  refund: boolean;
  settled: boolean;
}

/**
 * What the receipt of one transaction can say about the paid-off mark: null unless it is a posted credit card purchase
 * or refund in this workspace that can carry the mark (`carriesPaidOffMark`), otherwise which word fits and whether
 * the mark stands.
 */
export async function paidOffMarkOf(database: Database, ws: WorkspaceContext, transactionId: string): Promise<PaidOffMark | null> {
  // The card the transaction touched: the one account its statement is read from.
  const [row] = await database.db.values<[string]>(sql`
    SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.transaction_id = ${transactionId} AND e.workspace_id = ${ws.workspaceId}
      AND a.kind = 'liability' AND a.subtype = 'credit_card' AND e.amount_minor != 0
    LIMIT 1`);
  if (!row) return null;
  const line = (await cardStatementLines(database, ws, row[0])).find((candidate) => candidate.transactionId === transactionId && !candidate.instalment);
  if (!line || !carriesPaidOffMark(line)) return null;
  return { refund: line.owedMinor < 0, settled: line.paidOff };
}

/**
 * One statement of a card: what was owed before it, what it charged and credited, what it closed at,
 * and — once the statement date has passed — what has been paid since and what is left.
 */
export async function cardStatement(database: Database, ws: WorkspaceContext, cardAccountId: string, cycle: Cycle, today: string): Promise<CardStatement> {
  return (await cardStatements(database, ws, cardAccountId, [cycle], today))[0]!;
}

/**
 * Several statements of one card, its lines read once: what `cardStatement` gives each cycle, without reading the
 * card's whole history again per cycle (the Debt-free plan's months ask for a statement a month).
 */
export async function cardStatements(database: Database, ws: WorkspaceContext, cardAccountId: string, cycles: readonly Cycle[], today: string): Promise<CardStatement[]> {
  const [card] = await database.db
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, cardAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!card) throw new StatementError('NOT_FOUND', 'That card is not in this workspace');
  if (cycles.length === 0) return [];
  const all = await withFeeReversals(database, ws, await billedLines(database.db, ws, cardAccountId));
  const pool = poolLinesOf(all);
  return cycles.map((cycle) => statementOf(all, pool, cycle, today, card.currency ?? ws.baseCurrency));
}

function statementOf(all: StatementLine[], pool: readonly PoolLine[], cycle: Cycle, today: string, currency: string): CardStatement {
  // Everything here is in billed terms: an instalment plan counts a month at a time, not its whole price at once.
  const sum = (lines: StatementLine[]) => lines.reduce((total, line) => total + line.countedMinor, 0);

  const openingMinor = sum(all.filter((line) => line.statementOn < cycle.start));
  const lines = all.filter((line) => line.statementOn >= cycle.start && line.statementOn <= cycle.end);
  const chargesMinor = sum(lines.filter((line) => line.countedMinor > 0));
  const creditsMinor = -sum(lines.filter((line) => line.countedMinor < 0));
  const closingMinor = openingMinor + chargesMinor - creditsMinor;
  const closed = cycle.end < today;
  const since = closed ? all.filter((line) => line.countedMinor < 0 && line.statementOn > cycle.end && line.statementOn <= today) : [];
  const paidSinceMinor = -sum(since);
  return {
    cycle,
    currency,
    openingMinor,
    chargesMinor,
    creditsMinor,
    closingMinor,
    // The balancing settlements stay in the totals above, so the card stays even, but are not drawn.
    lines: lines.filter((line) => !line.balancing),
    closed,
    paidSinceMinor,
    leftToPayMinor: closed ? Math.max(0, closingMinor - paidSinceMinor) : null,
    laterCredits: since.filter((line) => !line.balancing),
    cover: statementCoverOf(pool, cycle, today),
  };
}

/**
 * The card's lines as the cover pool counts them. Whatever is settled on its own gives and takes nothing: a purchase
 * paid one by one, and of its payment as much as paid for the purchases it settled (a payment that settled purchases
 * only ever pays for those); a purchase or refund marked paid off before the app, and its balancing settlement, which
 * offsets only its own purchase whichever statement it falls on. What a payment paid beyond the purchases it settled is
 * an ordinary credit, as is any payment that settled none.
 */
function poolLinesOf(all: readonly StatementLine[]): PoolLine[] {
  const settledBy = new Map<string, number>();
  // What the settled purchases count, not their price: one converted to a plan since counts nothing, so its payment is
  // an ordinary credit again and covers the plan's instalments, which are what the card now bills.
  for (const line of all) if (line.paidBy && !line.instalment) settledBy.set(line.paidBy.transactionId, (settledBy.get(line.paidBy.transactionId) ?? 0) + line.countedMinor);
  return all.map((line) => {
    let poolMinor = line.countedMinor;
    if (line.balancing || line.paidOff || line.paidBy) poolMinor = 0;
    else if (line.countedMinor < 0 && settledBy.has(line.transactionId)) poolMinor = Math.min(0, line.countedMinor + settledBy.get(line.transactionId)!);
    return { key: line.key, statementOn: line.statementOn, poolMinor };
  });
}

/** What the card's payments cover of one statement's charges, oldest first: one answer for the statement and `payCardPurchases`. */
function statementCoverOf(pool: readonly PoolLine[], cycle: Cycle, today: string): Record<string, StatementCover> {
  const out: Record<string, StatementCover> = {};
  for (const [key, c] of coverStatement({ lines: pool, cycle, today })) {
    out[key] = { coveredMinor: c.coveredMinor, leftMinor: c.leftMinor, whole: c.whole, creditKey: c.credit?.key ?? null, credits: c.credits };
  }
  return out;
}

/** One instalment of a plan and where it stands: billed on a statement that is paid, billed, or still to come. */
export interface PlanInstalmentStatus {
  number: number;
  of: number;
  statementOn: string;
  amountMinor: number;
  status: 'paid' | 'billed' | 'upcoming';
  /** Paid because the plan's list says so (a plan with no purchase), not because a payment covers it: it can be unticked. */
  ticked?: true;
}

/**
 * Each instalment of one plan and where it stands on a day — the one answer the plan's page, the card's Instalments
 * box, Debt-free and Recurring read: upcoming until its statement date, billed from then, and paid once ticked (a plan
 * with no purchase, `paidSoFar`) or once the card's payments cover it on that statement (`statementCoverOf`, oldest
 * first — what the statement's own ✓ says).
 */
export async function planInstalmentStatuses(database: Database, ws: WorkspaceContext, planId: string, today: string): Promise<PlanInstalmentStatus[]> {
  const [found] = await database.db.select({ cardAccountId: cardInstallments.cardAccountId }).from(cardInstallments).where(and(eq(cardInstallments.id, planId), eq(cardInstallments.workspaceId, ws.workspaceId)));
  if (!found) throw new StatementError('NOT_FOUND', 'That plan is not in this workspace');
  return (await cardPlanStatuses(database.db, ws, found.cardAccountId, today)).get(planId) ?? [];
}

/** `planInstalmentStatuses` for every plan in the workspace, by plan id: each card's lines read once. */
export async function allPlanInstalmentStatuses(database: Database, ws: WorkspaceContext, today: string): Promise<Record<string, PlanInstalmentStatus[]>> {
  const cards = [...new Set((await listInstallmentsTx(database.db, ws)).map((plan) => plan.cardAccountId))];
  const out: Record<string, PlanInstalmentStatus[]> = {};
  for (const cardAccountId of cards) for (const [planId, statuses] of await cardPlanStatuses(database.db, ws, cardAccountId, today)) out[planId] = statuses;
  return out;
}

async function cardPlanStatuses(db: Db, ws: WorkspaceContext, cardAccountId: string, today: string): Promise<Map<string, PlanInstalmentStatus[]>> {
  const plans = await listInstallmentsTx(db, ws, cardAccountId);
  const [terms] = await db
    .select({ statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  const statementDay = terms?.statementDay ?? 1;
  const all = await billedLines(db, ws, cardAccountId);
  const keys = new Set(all.map((line) => line.key));
  const pool = poolLinesOf(all);
  const covers = new Map<string, Record<string, StatementCover>>();
  const out = new Map<string, PlanInstalmentStatus[]>();
  for (const plan of plans) {
    out.set(
      plan.id,
      installmentSchedule(plan, statementDay).map((bill) => {
        const row = { number: bill.number, of: plan.months, statementOn: bill.statementOn, amountMinor: bill.amountMinor };
        if (!plan.transactionId && bill.number <= plan.paidSoFar) return { ...row, status: 'paid' as const, ticked: true as const };
        let status: PlanInstalmentStatus['status'] = bill.statementOn > today ? 'upcoming' : 'billed';
        const key = `${plan.id}#${bill.number}`;
        if (status === 'billed' && keys.has(key)) {
          const cycle = statementCycleFor(bill.statementOn, statementDay);
          if (!covers.has(cycle.start)) covers.set(cycle.start, statementCoverOf(pool, cycle, today));
          if (covers.get(cycle.start)![key]?.whole) status = 'paid';
        }
        return { ...row, status };
      }),
    );
  }
  return out;
}

/** Sets or clears the date the bank posted a card transaction. A purchase cannot be posted before it was made. */
export async function setPostedOn(database: Database, ws: WorkspaceContext, transactionId: string, postedOn: string | null): Promise<void> {
  const [tx] = await database.db
    .select({ occurredOn: transactions.occurredOn })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.workspaceId, ws.workspaceId), eq(transactions.status, 'posted')));
  if (!tx) throw new StatementError('NOT_FOUND', 'That transaction is not in this workspace');
  if (postedOn === null || postedOn === tx.occurredOn) {
    await database.db.delete(cardPostings).where(and(eq(cardPostings.transactionId, transactionId), eq(cardPostings.workspaceId, ws.workspaceId)));
    return;
  }
  if (!ISO.test(postedOn)) throw new StatementError('INVALID_DATE', `A posting date is YYYY-MM-DD, got "${postedOn}"`);
  if (postedOn < tx.occurredOn) throw new StatementError('POSTED_BEFORE_PURCHASE', 'The bank cannot post a purchase before it was made');
  await database.db
    .insert(cardPostings)
    .values({ transactionId, workspaceId: ws.workspaceId, postedOn })
    .onConflictDoUpdate({ target: cardPostings.transactionId, set: { postedOn } });
}

/** Moves a card purchase onto the statement after the one its date puts it in, the way a late-posted purchase is billed. */
export async function billOnNextStatement(database: Database, ws: WorkspaceContext, cardAccountId: string, transactionId: string): Promise<string> {
  const [terms] = await database.db
    .select({ statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  if (terms?.statementDay == null) throw new StatementError('NO_STATEMENT_DAY', 'Add the card’s statement day first');
  const line = (await cardLines(database.db, ws, cardAccountId)).find((l) => l.transactionId === transactionId);
  if (!line) throw new StatementError('NOT_FOUND', 'That transaction is not on this card');
  const postedOn = nextStatementStart(line.statementOn, terms.statementDay);
  await setPostedOn(database, ws, transactionId, postedOn);
  return postedOn;
}

/** Posting dates for the given transactions, for surfaces that place purchases in cycles. */
export async function postingDates(database: Database, ws: WorkspaceContext, transactionIds: readonly string[]): Promise<Map<string, string>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await database.db
    .select({ transactionId: cardPostings.transactionId, postedOn: cardPostings.postedOn })
    .from(cardPostings)
    .where(and(eq(cardPostings.workspaceId, ws.workspaceId), inArray(cardPostings.transactionId, [...transactionIds])));
  return new Map(rows.map((row) => [row.transactionId, row.postedOn]));
}

/**
 * Pays chosen card purchases now, before their statement: one transfer from a bank account to the card for
 * their total, remembered as paying exactly those purchases. A purchase a payment already partly covers (the
 * statement's oldest-first cover) is paid for what is left of it, given in `amountsMinor`; never more than it charged.
 */
export async function payCardPurchases(
  database: Database,
  ws: WorkspaceContext,
  input: {
    cardAccountId: string;
    fromAccountId: string;
    occurredOn: string;
    purchaseTransactionIds: readonly string[];
    /** What to pay of a purchase, by its id, when that is less than it charged. A purchase not named is paid whole. */
    amountsMinor?: Readonly<Record<string, number>>;
    /** The day the statement was read on, which decides the credits its cover counts. The payment's own date if not given. */
    today?: string;
    description?: string;
    /** Which goal the money came out of, when it took more than was free (spec §4.4). */
    setAside?: SetAsideChoice | null;
  },
): Promise<string> {
  const ids = [...new Set(input.purchaseTransactionIds)];
  if (ids.length === 0) throw new StatementError('NOTHING_TO_PAY', 'Choose the purchases to pay');
  return database.transaction(async (tx) => {
    const found = await tx
      .select({ id: accounts.id, currency: accounts.currency, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, [input.cardAccountId, input.fromAccountId])));
    const card = found.find((a) => a.id === input.cardAccountId);
    const from = found.find((a) => a.id === input.fromAccountId);
    if (!card?.currency || !from?.currency) throw new StatementError('NOT_FOUND', 'Choose the card and the account paying it');
    if (card.currency !== from.currency) throw new StatementError('CURRENCY', `Pay a ${card.currency} card from a ${card.currency} account, or record the payment as a transfer`);

    const all = await billedLines(tx, ws, input.cardAccountId);
    const lines = new Map(all.filter((line) => !line.instalment).map((line) => [line.transactionId, line]));
    const [terms] = await tx
      .select({ statementDay: cardTerms.statementDay })
      .from(cardTerms)
      .where(and(eq(cardTerms.accountId, input.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
    const today = input.today ?? input.occurredOn;
    // What the card's payments cover right now, statement by statement, the way the statement worked it out.
    const pool = poolLinesOf(all);
    const covers = new Map<string, Record<string, StatementCover>>();
    const coverOf = (line: StatementLine) => {
      if (terms?.statementDay == null) return undefined;
      const cycle = statementCycleFor(line.statementOn, terms.statementDay);
      if (!covers.has(cycle.start)) covers.set(cycle.start, statementCoverOf(pool, cycle, today));
      return covers.get(cycle.start)![line.key];
    };
    let totalMinor = 0;
    // Only a purchase paid whole is settled by the payment; one paid for what was left stays covered by payments.
    const settles: string[] = [];
    for (const id of ids) {
      const line = lines.get(id);
      if (!line || line.owedMinor <= 0) throw new StatementError('NOT_A_CHARGE', 'Only purchases on this card can be paid this way');
      if (line.paidBy) throw new StatementError('ALREADY_PAID', `“${line.description}” was already paid on ${line.paidBy.paidOn}`);
      const amountMinor = input.amountsMinor?.[id] ?? line.owedMinor;
      if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > line.owedMinor) {
        throw new StatementError('INVALID_AMOUNT', `Pay between nothing and the whole of “${line.description}”`);
      }
      const cover = coverOf(line);
      if (cover?.whole) throw new StatementError('STALE_AMOUNT', 'Already covered by a payment. Open the statement again.');
      if (cover && amountMinor > cover.leftMinor) throw new StatementError('STALE_AMOUNT', 'Already partly covered by a payment. Open the statement again.');
      if (amountMinor === line.owedMinor) settles.push(id);
      totalMinor += amountMinor;
    }

    const paymentId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      // How many purchases it settled is kept in the settlements themselves, so the description stays plain.
      description: input.description?.trim() || `${card.name} payment`,
      lines: transferLines({ fromAccountId: from.id, toAccountId: card.id, amountMinor: totalMinor, currency: card.currency }),
      setAside: input.setAside,
    });
    for (const id of settles) {
      // A settlement left behind by a payment since deleted is replaced, not kept beside this one.
      await tx
        .insert(cardSettlements)
        .values({ purchaseTransactionId: id, paymentTransactionId: paymentId, workspaceId: ws.workspaceId })
        .onConflictDoUpdate({ target: cardSettlements.purchaseTransactionId, set: { paymentTransactionId: paymentId } });
    }
    return paymentId;
  });
}
