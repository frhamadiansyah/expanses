import { formatMinor, monthName } from '@expanses/core';
import type { AccountRow, CardRow, PersonDebtRow, TransactionView } from '@expanses/db';
import type { PurchasePoints } from '../../lib/purchase-points';
import { formatPoints } from '../cards/useCardPoints';

/**
 * What a receipt says, line by line, worked out away from the screen that shows it.
 *
 * Every figure on B8 is decided here, so `ReceiptPage` holds no arithmetic at all: it takes labels and strings
 * and lays them out. That is what lets the sums be tested without a browser — and a receipt's sums are the ones
 * that matter most, because it is the screen someone opens when they do not believe the list.
 */
export interface ReceiptLine {
  label: string;
  value: string;
  /** The points line, which the list already paints in the programme's colour. */
  tone?: 'points';
}

export interface ReceiptInput {
  tx: TransactionView;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  /** The currency the screen reads in, used only when the transaction's own entries cannot say. */
  currency: string;
  points: PurchasePoints | null;
  /** What each person owes on *this* transaction, taken from its own debt entries. */
  owed: readonly Pick<PersonDebtRow, 'personName' | 'totalMinor'>[];
  eventName?: string;
  goalName?: string;
}

/** Money accounts: the two kinds whose entry says what was actually charged or received. */
const MONEY = new Set(['asset', 'liability']);

/** The entry that says what was really charged or received — the money that left, or, failing that, that arrived. */
function paidEntry(tx: TransactionView) {
  const money = tx.entries.filter((entry) => MONEY.has(entry.accountKind));
  const left = money.filter((entry) => entry.amountMinor < 0).sort((a, b) => a.amountMinor - b.amountMinor);
  const arrived = money.filter((entry) => entry.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor);
  return { left, arrived, paid: left[0] ?? arrived[0], into: left[0] ? arrived[0] : undefined };
}

/**
 * The word between the two figures on a split bill — null when there is only one figure to read.
 *
 * The big number at the top is what the transaction cost **you**: on a dinner you paid 400.000 for and were
 * paid back 300.000 of, it is 100.000, and it matches the list row this screen was opened from. The `Total`
 * line under it is what the **card** was charged: 400.000. Both are right, and a screen that showed them one
 * above the other with nothing to tell them apart read as an arithmetic mistake. So the hero says which one
 * it is, and only when it differs — on an ordinary purchase the two are the same figure and a caption would
 * only be noise.
 */
export function heroCaption(tx: TransactionView, heroMinor: number): string | null {
  const { paid } = paidEntry(tx);
  if (!paid) return null;
  return Math.abs(paid.amountMinor) === heroMinor ? null : 'Your share';
}

/** "Andi" · "Andi and Putri" · "Andi, Putri and Chika" — the way a person reads a list aloud. */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The same treatment the list's points badge gives (`TransactionsPage.tsx`): the id-ID grouping of
 * `formatPoints`, `≈` for an estimate, `−` for a refund handing points back. The badge's leading `+` is the one
 * thing left off — the line is labelled "Points earned", so a plus would say it a second time.
 */
function pointsText(points: PurchasePoints): string {
  const mark = points.points < 0 ? '−' : points.approximate ? '≈ ' : '';
  return `${mark}${formatPoints(Math.abs(points.points))} ${points.unit}`;
}

/**
 * B8's lines in B8's order, **leaving out every line there is nothing to say about**: a receipt with no points,
 * nobody owing and no event is two lines, not nine of them holding a dash.
 */
export function receiptLines(input: ReceiptInput): ReceiptLine[] {
  const { tx, accounts, cards, points, owed } = input;
  const nameOf = (accountId: string) => accounts.find((account) => account.id === accountId)?.name ?? '';
  // The card's last four, and only when the transaction names the card the account was charged through: an
  // account holding two cards must not lend the primary's digits to a purchase made on the supplementary.
  const card = tx.cardId ? cards.find((row) => row.id === tx.cardId) : undefined;
  const accountText = (accountId: string) => (card && card.accountId === accountId && card.last4 ? `${nameOf(accountId)} ···· ${card.last4}` : nameOf(accountId));

  // Money that left is what was paid with; money that only arrived — a salary, a refund — was paid *into*.
  // A transfer touches two money accounts, and a receipt that named only the first would hide where it went.
  const { left, paid, into } = paidEntry(tx);
  const currency = paid?.currency ?? input.currency;

  const lines: ReceiptLine[] = [];
  if (paid) lines.push({ label: left[0] ? 'Paid with' : 'Paid into', value: accountText(paid.accountId) });
  if (into) lines.push({ label: 'Into', value: accountText(into.accountId) });
  // What the account was really charged, never the share that was kept: a split bill's card entry is the whole
  // bill, and the chart's treatment of it changes nothing about what the bank will ask for.
  if (paid) lines.push({ label: 'Total', value: formatMinor(Math.abs(paid.amountMinor), currency) });
  if (points) lines.push({ label: 'Points earned', value: pointsText(points), tone: 'points' });
  if (owed.length > 0) {
    const total = owed.reduce((sum, person) => sum + person.totalMinor, 0);
    lines.push({ label: `${nameList(owed.map((person) => person.personName))} ${owed.length === 1 ? 'owes' : 'owe'} you`, value: formatMinor(total, currency) });
    // Your own share is the expense side of the split. A bill none of which was yours has no share line.
    const share = tx.entries.filter((entry) => entry.accountKind === 'expense').reduce((sum, entry) => sum + entry.amountMinor, 0);
    if (share !== 0) lines.push({ label: 'Your share', value: formatMinor(share, currency) });
  }
  if (input.eventName) lines.push({ label: 'Event', value: input.eventName });
  // Not in B8's list, but the list row says "· for Umrah" today, and a receipt that dropped it would hide a
  // field the screen it replaces already shows.
  if (input.goalName) lines.push({ label: 'For goal', value: input.goalName });
  if (tx.channel) lines.push({ label: 'Channel', value: tx.channel === 'online' ? 'Online' : 'Offline' });
  // What the merchant charged, in the merchant's own currency and at that currency's own exponent.
  if (tx.originalCurrency && tx.originalAmountMinor !== null && tx.originalAmountMinor !== undefined) {
    lines.push({ label: 'Original amount', value: formatMinor(Math.abs(tx.originalAmountMinor), tx.originalCurrency) });
  }
  if (tx.billMonth) lines.push({ label: 'Bill month', value: `${monthName(tx.billMonth, 'long')} ${tx.billMonth.slice(0, 4)}` });
  return lines;
}
