import { type Cycle, installmentSchedule, nextStatementStart, transferLines } from '@expanses/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, transactions } from '../schema';
import { cardPostings, cardSettlements } from '../schema-cards';
import { cardTerms } from '../schema-points';
import { splitBooksOfMany } from './book-splits';
import { listInstallments } from './installments';
import { postTransactionTx } from './ledger';
import type { SetAsideChoice } from './set-aside-tx';

export class StatementError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'POSTED_BEFORE_PURCHASE' | 'INVALID_DATE' | 'NO_STATEMENT_DAY' | 'NOTHING_TO_PAY' | 'NOT_A_CHARGE' | 'ALREADY_PAID' | 'CURRENCY',
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
  /** For an instalment row: which plan, and which of its months. */
  instalment: { planId: string; number: number; of: number } | null;
  /** For a purchase converted to instalments: the plan it became. */
  convertedTo: { planId: string; months: number } | null;
  /** A purchase or refund, as opposed to money moved onto the card. */
  spending: boolean;
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
   * A purchase split across workspaces (0084) is one line, the whole charge as the bank prints it; these are its parts'
   * categories, largest first, for the line to name ("Groceries · Office supplies"). Absent on any other line.
   */
  splitCategories?: string[];
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
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The ref a purchase's paid-off-before-the-app settlement carries (ledger's `beforeAppRef`). */
const BEFORE_APP = 'before-app:';

async function cardLines(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  const rows = await db.values<[string, string, string | null, string, string | null, number, number, string | null, string | null, string | null, number | null, number, string | null]>(sql`
    SELECT t.id, t.occurred_on, p.posted_on, t.description, t.card_id,
      -SUM(e.amount_minor),
      EXISTS (SELECT 1 FROM entries x JOIN accounts xa ON xa.id = x.account_id WHERE x.transaction_id = t.id AND xa.kind IN ('expense', 'income'))
        OR EXISTS (SELECT 1 FROM entries y WHERE y.transaction_id = t.id AND y.spend_category_id IS NOT NULL),
      pay.id, pay.occurred_on, t.original_currency, t.original_amount_minor,
      (SELECT COUNT(*) FROM card_settlements cs WHERE cs.payment_transaction_id = t.id),
      t.external_ref
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
  return rows
    .map(([transactionId, occurredOn, postedOn, description, cardId, owed, spending, paymentId, paidOn, originalCurrency, originalAmount, settles, ref]) => ({
      transactionId,
      occurredOn,
      postedOn,
      statementOn: postedOn ?? occurredOn,
      description,
      cardId,
      key: transactionId,
      owedMinor: Number(owed),
      countedMinor: Number(owed),
      instalment: null,
      convertedTo: null,
      spending: Boolean(spending),
      originalCurrency,
      originalAmountMinor: originalAmount === null ? null : Number(originalAmount),
      paidBy: paymentId && paidOn ? { transactionId: paymentId, paidOn } : null,
      settles: Number(settles),
      paidOff: settled.has(transactionId),
      balancing: ref?.startsWith(BEFORE_APP) ?? false,
      ...(partNames.has(transactionId) ? { splitCategories: partNames.get(transactionId)! } : {}),
    }))
    .sort((a, b) => a.statementOn.localeCompare(b.statementOn) || a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId));
}

/**
 * The card's lines as the bank bills them: a purchase converted to a plan stays in its place but counts nothing,
 * and each instalment is a row on the statement it is billed on. Plans not tied to a purchase on this card are
 * left out, since there is no purchase here for them to replace.
 */
async function billedLines(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  const lines = await cardLines(database.db, ws, cardAccountId);
  const [terms] = await database.db
    .select({ statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.accountId, cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
  const byTransaction = new Map(lines.map((line) => [line.transactionId, line]));
  const instalments: StatementLine[] = [];
  for (const plan of await listInstallments(database, ws, cardAccountId)) {
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
        instalment: { planId: plan.id, number: bill.number, of: plan.months },
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
  return [...lines, ...instalments].sort(
    (a, b) => a.statementOn.localeCompare(b.statementOn) || a.occurredOn.localeCompare(b.occurredOn) || a.key.localeCompare(b.key),
  );
}

/** Every line the card has ever had, as statements bill them, for searching across statements. */
export async function cardStatementLines(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  return (await billedLines(database, ws, cardAccountId)).filter((line) => !line.balancing);
}

/**
 * Whether a line can carry the paid-off mark (`setSettledBeforeApp`), or already does: a purchase there is still
 * something to pay for, or money back (a refund) whose credit was used up — left standing, it would sit on the card as
 * a credit for ever. Never a payment, a purchase a recorded payment settled, an instalment row or a purchase converted
 * to a plan. One answer for the statement's swipe, its ⋯ and the receipt's switch.
 */
export function carriesPaidOffMark(line: StatementLine): boolean {
  return line.spending && line.owedMinor !== 0 && !line.paidBy && !line.instalment && !line.convertedTo;
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
  const [card] = await database.db
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, cardAccountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!card) throw new StatementError('NOT_FOUND', 'That card is not in this workspace');
  const all = await billedLines(database, ws, cardAccountId);
  // Everything here is in billed terms: an instalment plan counts a month at a time, not its whole price at once.
  const sum = (lines: StatementLine[]) => lines.reduce((total, line) => total + line.countedMinor, 0);

  const openingMinor = sum(all.filter((line) => line.statementOn < cycle.start));
  const lines = all.filter((line) => line.statementOn >= cycle.start && line.statementOn <= cycle.end);
  const chargesMinor = sum(lines.filter((line) => line.countedMinor > 0));
  const creditsMinor = -sum(lines.filter((line) => line.countedMinor < 0));
  const closingMinor = openingMinor + chargesMinor - creditsMinor;
  const closed = cycle.end < today;
  const paidSinceMinor = closed ? -sum(all.filter((line) => line.countedMinor < 0 && line.statementOn > cycle.end && line.statementOn <= today)) : 0;
  return {
    cycle,
    currency: card.currency ?? ws.baseCurrency,
    openingMinor,
    chargesMinor,
    creditsMinor,
    closingMinor,
    // The balancing settlements stay in the totals above, so the card stays even, but are not drawn.
    lines: lines.filter((line) => !line.balancing),
    closed,
    paidSinceMinor,
    leftToPayMinor: closed ? Math.max(0, closingMinor - paidSinceMinor) : null,
  };
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
  if (!terms) throw new StatementError('NO_STATEMENT_DAY', 'Add the card’s statement day first');
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
 * their total, remembered as paying exactly those purchases.
 */
export async function payCardPurchases(
  database: Database,
  ws: WorkspaceContext,
  input: {
    cardAccountId: string;
    fromAccountId: string;
    occurredOn: string;
    purchaseTransactionIds: readonly string[];
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

    const lines = new Map((await cardLines(tx, ws, input.cardAccountId)).map((line) => [line.transactionId, line]));
    let totalMinor = 0;
    for (const id of ids) {
      const line = lines.get(id);
      if (!line || line.owedMinor <= 0) throw new StatementError('NOT_A_CHARGE', 'Only purchases on this card can be paid this way');
      if (line.paidBy) throw new StatementError('ALREADY_PAID', `“${line.description}” was already paid on ${line.paidBy.paidOn}`);
      totalMinor += line.owedMinor;
    }

    const paymentId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      // How many purchases it settled is kept in the settlements themselves, so the description stays plain.
      description: input.description?.trim() || `${card.name} payment`,
      lines: transferLines({ fromAccountId: from.id, toAccountId: card.id, amountMinor: totalMinor, currency: card.currency }),
      setAside: input.setAside,
    });
    for (const id of ids) {
      // A settlement left behind by a payment since deleted is replaced, not kept beside this one.
      await tx
        .insert(cardSettlements)
        .values({ purchaseTransactionId: id, paymentTransactionId: paymentId, workspaceId: ws.workspaceId })
        .onConflictDoUpdate({ target: cardSettlements.purchaseTransactionId, set: { paymentTransactionId: paymentId } });
    }
    return paymentId;
  });
}
