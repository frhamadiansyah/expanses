import { type Cycle, nextStatementStart, transferLines } from '@expanses/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts, transactions } from '../schema';
import { cardPostings, cardSettlements } from '../schema-cards';
import { cardTerms } from '../schema-points';
import { postTransactionTx } from './ledger';

export class StatementError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'POSTED_BEFORE_PURCHASE' | 'INVALID_DATE' | 'NO_STATEMENT_DAY' | 'NOTHING_TO_PAY' | 'NOT_A_CHARGE' | 'ALREADY_PAID' | 'CURRENCY',
    message: string,
  ) {
    super(message);
    this.name = 'StatementError';
  }
}

/** One transaction as a card statement sees it. */
export interface StatementLine {
  transactionId: string;
  occurredOn: string;
  /** The bank's posting date, when the owner gave one. */
  postedOn: string | null;
  /** The date that decides the statement: the posting date when there is one, otherwise the purchase date. */
  statementOn: string;
  description: string;
  cardId: string | null;
  /** What it added to the balance owed: positive for a charge, negative for a payment or refund. */
  owedMinor: number;
  /** A purchase or refund, as opposed to money moved onto the card. */
  spending: boolean;
  /** The payment that was made for this purchase, while that payment stands. */
  paidBy: { transactionId: string; paidOn: string } | null;
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

async function cardLines(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<StatementLine[]> {
  const rows = await db.values<[string, string, string | null, string, string | null, number, number, string | null, string | null]>(sql`
    SELECT t.id, t.occurred_on, p.posted_on, t.description, t.card_id,
      -SUM(e.amount_minor),
      EXISTS (SELECT 1 FROM entries x JOIN accounts xa ON xa.id = x.account_id WHERE x.transaction_id = t.id AND xa.kind IN ('expense', 'income'))
        OR EXISTS (SELECT 1 FROM entries y WHERE y.transaction_id = t.id AND y.spend_category_id IS NOT NULL),
      pay.id, pay.occurred_on
    FROM transactions t
    JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${cardAccountId}
    LEFT JOIN card_postings p ON p.transaction_id = t.id
    LEFT JOIN card_settlements s ON s.purchase_transaction_id = t.id
    LEFT JOIN transactions pay ON pay.id = s.payment_transaction_id AND pay.status = 'posted'
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
    GROUP BY t.id
  `);
  return rows
    .map(([transactionId, occurredOn, postedOn, description, cardId, owed, spending, paymentId, paidOn]) => ({
      transactionId,
      occurredOn,
      postedOn,
      statementOn: postedOn ?? occurredOn,
      description,
      cardId,
      owedMinor: Number(owed),
      spending: Boolean(spending),
      paidBy: paymentId && paidOn ? { transactionId: paymentId, paidOn } : null,
    }))
    .sort((a, b) => a.statementOn.localeCompare(b.statementOn) || a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId));
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
  const all = await cardLines(database.db, ws, cardAccountId);
  const sum = (lines: StatementLine[]) => lines.reduce((total, line) => total + line.owedMinor, 0);

  const openingMinor = sum(all.filter((line) => line.statementOn < cycle.start));
  const lines = all.filter((line) => line.statementOn >= cycle.start && line.statementOn <= cycle.end);
  const chargesMinor = sum(lines.filter((line) => line.owedMinor > 0));
  const creditsMinor = -sum(lines.filter((line) => line.owedMinor < 0));
  const closingMinor = openingMinor + chargesMinor - creditsMinor;
  const closed = cycle.end < today;
  const paidSinceMinor = closed ? -sum(all.filter((line) => line.owedMinor < 0 && line.statementOn > cycle.end && line.statementOn <= today)) : 0;
  return {
    cycle,
    currency: card.currency ?? ws.baseCurrency,
    openingMinor,
    chargesMinor,
    creditsMinor,
    closingMinor,
    lines,
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
  input: { cardAccountId: string; fromAccountId: string; occurredOn: string; purchaseTransactionIds: readonly string[]; description?: string },
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
      description: input.description?.trim() || `${card.name} payment, ${ids.length} purchase${ids.length === 1 ? '' : 's'}`,
      lines: transferLines({ fromAccountId: from.id, toAccountId: card.id, amountMinor: totalMinor, currency: card.currency }),
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
