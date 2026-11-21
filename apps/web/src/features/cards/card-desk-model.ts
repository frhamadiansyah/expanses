import type { CardRow, CardStatement, StatementLine } from '@expanses/db';
import { type StatementPayPurchase, statementPayChoice } from './card-pay';
import { dueDateAfter, dueIn } from './statement-dates';
import { statementTotals } from './statement-totals';

/*
 * A credit card's page on a wide screen (Mac account pages, owner 2026-11-20) as data: which statement the table shows,
 * the bill box's figures, the two optional columns, and what Pay pays for the purchases ⌘-picked on it. Each is read by
 * the phone's own rules (`statementTotals`, `statementPayChoice`, `dueIn`), so the two pages never say different things.
 */

/** The title bar's switch: the statement still open, the last one cut (the bill to pay), or every statement's lines. */
export type StatementChoice = 'this' | 'last' | 'all';

/** How many statements back the choice is; null for All, which is no one statement. */
export const choiceBack = (choice: StatementChoice): number | null => (choice === 'this' ? 0 : choice === 'last' ? 1 : null);

/**
 * The Card column is drawn only when the account carries more than one card — a supplementary beside the primary. One
 * card alone (•4417) needs no column: every row is on it. Only the account's own cards count, should the list hold others.
 */
export const showsCardColumn = (plastic: readonly Pick<CardRow, 'id' | 'accountId'>[], accountId: string): boolean => plastic.filter((piece) => piece.accountId === accountId).length > 1;

/** The miles or points column is drawn only when the card works its points out: a programme with at least one rule. */
export const showsPointsColumn = (cp: { program?: unknown; rules: readonly unknown[] }): boolean => !!cp.program && cp.rules.length > 0;

/** The bill box: the last statement cut, what is left to pay of it, what has been paid since, and when it is due. */
export type BillBox =
  | { state: 'no-terms' }
  | { state: 'nothing'; statementOn: string }
  | { state: 'paid' | 'due'; statementOn: string; toPayMinor: number; paidMinor: number; billMinor: number; dueOn: string | null; due: ReturnType<typeof dueIn> | null };

/**
 * What the card's bill box says, from the last statement cut (`last`, read for its cycle up to today) and the card's due
 * day: what the phone's card page says under its figure (nothing billed, paid in full, or due on a day), as figures.
 */
export function billBox(last: CardStatement | undefined, terms: { dueDay: number } | undefined | null, today: string): BillBox {
  if (!terms || !last) return { state: 'no-terms' };
  const statementOn = last.cycle.end;
  if (last.closingMinor <= 0) return { state: 'nothing', statementOn };
  const totals = statementTotals(last);
  const toPayMinor = last.leftToPayMinor ?? totals.leftMinor;
  const dueOn = dueDateAfter(statementOn, terms.dueDay);
  return {
    state: toPayMinor > 0 ? 'due' : 'paid',
    statementOn,
    toPayMinor,
    paidMinor: totals.paidMinor,
    billMinor: totals.billMinor,
    dueOn,
    due: dueOn ? dueIn(today, dueOn) : null,
  };
}

/**
 * The purchases ⌘-picked on a statement that Pay pays, and their total: those the statement still lets be paid, each for
 * what is left of it — exactly what the "Pay credit card" screen lists and fills in (`statementPayChoice`).
 */
export function pickedPay(statement: CardStatement | undefined, ids: readonly string[]): { purchases: StatementPayPurchase[]; totalMinor: number } {
  const purchases = statement && ids.length > 0 ? statementPayChoice(statement, ids) : [];
  return { purchases, totalMinor: purchases.reduce((sum, purchase) => sum + purchase.leftMinor, 0) };
}

/**
 * Cashback & Rewards put on the card this statement (owner, 17 Nov 2026: it lowers spending): the money back on its
 * lines filed under that category, as a positive figure.
 */
export function cashbackMinor(lines: readonly StatementLine[], isCashback: (transactionId: string) => boolean): number {
  return lines.reduce((sum, line) => (line.spending && line.owedMinor < 0 && isCashback(line.transactionId) ? sum - line.owedMinor : sum), 0);
}

/** A statement's lines newest first, as the table reads (the statement lists them oldest first). */
export function newestFirst<T extends Pick<StatementLine, 'occurredOn' | 'statementOn'>>(lines: readonly T[]): T[] {
  return [...lines].reverse().sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
}
