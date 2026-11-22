import { formatMinor, isCardCashbackKey, monthName } from '@expanses/core';
import type { AccountRow, CardRow, PersonDebtRow, PurchasePayer, SplitBook, TransactionView, WithdrawalsUsed } from '@expanses/db';
import { fromWithdrawalsText, receiptWithdrawalLine, transferRateParts } from '../../lib/withdrawal-rate';
import { classify } from './classify';
import { isNotCountedLine } from './list-model';
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
  /** A second, grey line under the value: the market beside a transfer's Rate. */
  detail?: string;
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
  /**
   * Who paid, for a purchase in a shared workspace (household sharing spec §11): its "Paid with" is what the payer's
   * own device called it, and a "Paid by" line names them. A purchase another member paid for is posted here against
   * a placeholder account that is never named or linked, so this is the only place its payment is described.
   */
  payer?: PurchasePayer | null;
  /**
   * Which withdrawals a spend from foreign money came from, and what it cost at them (withdrawal rate §7). Null or
   * absent for anything that did not take foreign money; `currency` above is the base it is read in.
   */
  withdrawal?: WithdrawalsUsed | null;
  /** Today, for "From the 12 Nov withdrawal" (a withdrawal in another year names its year). */
  today?: string;
  /** The market rates held for the transaction's day, to the base: what a transfer between currencies is read against. */
  ratesToBase?: Readonly<Record<string, number>>;
  /** Each household placeholder's member, by the name the workspace holds now (`memberPayerAccounts`): who a transfer went to. */
  memberNames?: ReadonlyMap<string, { name: string }>;
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
  // A transfer is never a share: its hero is what landed, which differs from what left by a fee beside it or, between
  // two currencies, by being another currency. It reads as every transfer's receipt does, with no word under it.
  if (classify(tx).type === 'transfer') return null;
  return Math.abs(paid.amountMinor) === heroMinor ? null : 'My share';
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
 * A transfer between two currencies, one of them the base (`transferRateParts`): its Rate row's two lines. What was
 * changed is the exchange account's line in the currency that left — never a fee charged beside it — and what arrived.
 */
function exchangeRateOf(tx: TransactionView, baseCurrency: string, ratesToBase: Readonly<Record<string, number>>) {
  if (classify(tx).type !== 'transfer') return null;
  const { left, into } = paidEntry(tx);
  const from = left[0];
  if (!from || !into || from.currency === into.currency) return null;
  const changed = tx.entries.find((entry) => entry.accountSystemKey === 'currency_exchange' && entry.currency === from.currency && entry.amountMinor > 0);
  return transferRateParts({
    fromMinor: changed?.amountMinor ?? -from.amountMinor,
    fromCurrency: from.currency,
    toMinor: into.amountMinor,
    toCurrency: into.currency,
    baseCurrency,
    ratesToBase,
  });
}

/**
 * B8's lines in B8's order, **leaving out every line there is nothing to say about**: a receipt with no points,
 * nobody owing and no event is two lines, not nine of them holding a dash.
 */
export function receiptLines(input: ReceiptInput): ReceiptLine[] {
  const { tx, accounts, cards, points, owed } = input;
  // On a transfer, a household placeholder this phone does not list is the partner it stands for: by the member's name
  // as the workspace holds it now, else as the line names it ("Dewi"), as the edit form's To does. A purchase never
  // names one: who paid is the Paid by line's to say.
  const transfer = classify(tx).type === 'transfer';
  const partnerName = (accountId: string) =>
    transfer && tx.entries.some((entry) => entry.accountId === accountId && entry.placeholder)
      ? (input.memberNames?.get(accountId)?.name ?? tx.entries.find((entry) => entry.accountId === accountId)?.accountName ?? '')
      : '';
  const nameOf = (accountId: string) => accounts.find((account) => account.id === accountId)?.name ?? partnerName(accountId);
  // The card's last four, and only when the transaction names the card the account was charged through: an
  // account holding two cards must not lend the primary's digits to a purchase made on the supplementary.
  // A card since removed is still the card it was made with: it keeps its digits, and says it was removed.
  const card = tx.cardId ? cards.find((row) => row.id === tx.cardId) : undefined;
  const accountText = (accountId: string) =>
    card && card.accountId === accountId
      ? `${nameOf(accountId)}${card.last4 ? ` ···· ${card.last4}` : ''}${card.archived ? ' · removed card' : ''}`
      : nameOf(accountId);

  // Money that left is what was paid with; money that only arrived — a salary, a refund — was paid *into*.
  // A transfer touches two money accounts, and a receipt that named only the first would hide where it went.
  const { left, paid, into } = paidEntry(tx);
  const currency = paid?.currency ?? input.currency;

  const lines: ReceiptLine[] = [];
  const payer = input.payer ?? null;
  // One purchase split across workspaces: the whole charge, on the account it was charged to, is the line the bank
  // prints; its parts follow on the receipt, each in its own workspace.
  // So is one with a part counted in no workspace (Not counted): the charge is more than any workspace counts.
  const across = (!!tx.splitBooks || tx.entries.some(isNotCountedLine)) && !payer && !!left[0];
  if (across && paid) {
    lines.push({ label: `Charged on ${accountText(paid.accountId)}`, value: formatMinor(Math.abs(paid.amountMinor), currency) });
  } else if (payer) {
    if (payer.paidLabel) lines.push({ label: 'Payment method', value: payer.paidLabel });
    lines.push({ label: 'Paid by', value: payer.mine ? 'Me' : (payer.payerName ?? 'Someone else') });
  } else if (paid) lines.push({ label: left[0] ? (transfer ? 'From' : 'Payment method') : 'Paid into', value: accountText(paid.accountId) });
  if (into) lines.push({ label: 'Into', value: accountText(into.accountId) });
  // What the account was really charged, never the share that was kept: a split bill's card entry is the whole
  // bill, and the chart's treatment of it changes nothing about what the bank will ask for.
  // Money back on a purchase: its category was credited. Said so, and its total reads as money in.
  const spent = tx.entries.filter((entry) => entry.accountKind === 'expense');
  const refund = spent.length > 0 && spent.reduce((sum, entry) => sum + entry.amountMinor, 0) < 0;
  // Cashback & Rewards into a credit card is no refund of anything: it says what it does instead (owner, 17 Nov 2026).
  const cashback = refund && spent.every((entry) => isCardCashbackKey(entry.accountSystemKey));
  if (cashback) lines.push({ label: 'Cashback', value: 'Lowers spending' });
  else if (refund) lines.push({ label: 'Refund', value: 'Money back' });
  if (paid && !across) lines.push({ label: 'Total', value: `${refund ? '+' : ''}${formatMinor(Math.abs(paid.amountMinor), currency)}` });
  // A transfer between currencies (owner, 17 Nov 2026): one Rate row, what the bank gave against the day's market. Its
  // Cost and Withdrawn go: the difference from what the money cost counts nowhere, so the receipt does not weigh it.
  const rate = exchangeRateOf(tx, input.currency, input.ratesToBase ?? {});
  if (rate) lines.push({ label: 'Rate', value: rate.rate, ...(rate.market ? { detail: rate.market } : {}) });
  // Withdrawal rate §7: what the foreign money cost, and which withdrawals it came from.
  else if (input.withdrawal) {
    const cost = receiptWithdrawalLine(input.withdrawal, input.withdrawal.currency, input.currency);
    if (cost) lines.push({ label: 'Cost', value: cost });
    const from = fromWithdrawalsText(input.withdrawal.uses, input.today ?? tx.occurredOn);
    if (from) lines.push({ label: 'Withdrawn', value: from });
  }
  if (points) lines.push({ label: 'Points earned', value: pointsText(points), tone: 'points' });
  if (owed.length > 0) {
    const total = owed.reduce((sum, person) => sum + person.totalMinor, 0);
    lines.push({ label: `Owed by ${nameList(owed.map((person) => person.personName))}`, value: formatMinor(total, currency) });
    // This share is the expense side of the split. A bill none of which was paid from here has no share line.
    const share = tx.entries.filter((entry) => entry.accountKind === 'expense').reduce((sum, entry) => sum + entry.amountMinor, 0);
    if (share !== 0) lines.push({ label: 'My share', value: formatMinor(share, currency) });
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

/** One part of a purchase split across workspaces, as the receipt lists it. */
export interface SplitPart {
  /** The category, or '' for a part counted in no workspace. */
  categoryId: string;
  /** The category's name, or "Not counted". */
  categoryName: string;
  /** The workspace the part is counted in; null for a part Not counted, which is in none. */
  book: SplitBook | null;
  amountMinor: number;
  currency: string;
  /** Left out of its workspace's reports (0090): the chart and budgets there, not the card. */
  excluded: boolean;
}

/**
 * The parts of a split purchase, in the order its workspaces are listed, largest first within one: each category line,
 * the workspace it is filed in, what it came to and whether that part is left out of the workspace's reports — then
 * any part counted in no workspace ("Not counted"). Across workspaces each line names its own; in one workspace with a
 * part Not counted, `book` (the workspace the purchase is filed in) names them all and the purchase's own flag is
 * theirs. Empty for anything else, where there are no parts to tell apart.
 */
export function splitParts(tx: TransactionView, accounts: readonly AccountRow[], book: SplitBook | null = null): SplitPart[] {
  const notCounted = tx.entries.filter(isNotCountedLine);
  const categoryLine = (entry: TransactionView['entries'][number]) => entry.accountKind === 'expense' || entry.accountKind === 'income';
  // A split in one workspace shows its lines when one of them is left out on its own (0096): which one is the news.
  const someLeftOut = tx.entries.filter(categoryLine).length > 1 && tx.entries.some((entry) => categoryLine(entry) && entry.excluded === true);
  if (!tx.splitBooks && notCounted.length === 0 && !someLeftOut) return [];
  const books: SplitBook[] = tx.splitBooks ?? (book ? [{ ...book, excluded: tx.excluded ?? false }] : []);
  const part = (entry: TransactionView['entries'][number], of: SplitBook | null): SplitPart => ({
    categoryId: entry.accountId,
    categoryName: accounts.find((account) => account.id === entry.accountId)?.name ?? entry.accountName,
    book: of,
    amountMinor: entry.accountKind === 'income' ? -entry.amountMinor : entry.amountMinor,
    currency: entry.currency,
    // Each line says it itself (0096); a part left out whole is every line of it left out.
    excluded: (tx.excluded ?? false) || entry.excluded === true || (of?.excluded ?? false),
  });
  const largestFirst = (a: { amountMinor: number }, b: { amountMinor: number }) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor);
  const filed = tx.splitBooks
    ? books.flatMap((one) => tx.entries.filter((entry) => entry.bookId === one.id && categoryLine(entry)).sort(largestFirst).map((entry) => part(entry, one)))
    : tx.entries.filter(categoryLine).sort(largestFirst).map((entry) => part(entry, books[0] ?? null));
  return [
    ...filed,
    ...notCounted.sort(largestFirst).map((entry) => ({ ...part(entry, null), categoryId: '', categoryName: 'Not counted', excluded: false })),
  ];
}
