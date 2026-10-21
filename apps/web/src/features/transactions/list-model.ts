import { compareWithinDay, dayNet, formatMinor, isUncategorisedKey, matchesSearch, monthName, parsePeriod } from '@expanses/core';
import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import type { PurchasePoints } from '../../lib/purchase-points';
import { formatPoints } from '../cards/format-points';
import { classify } from './classify';

/**
 * The transactions list as data: recorded transactions and drafts not yet recorded, in one shape, so
 * search, filters, sorting, days and totals treat both the same way and can be tested without a page.
 */

/**
 * "Aug bill" on a bill payment made in another month than the bill it settles. The list keeps the day it was paid;
 * the budget and the chart count it in its bill month, and the tag is what says why.
 */
export function billTagOf(tx: Pick<TransactionView, 'occurredOn' | 'billMonth'>): string | null {
  return tx.billMonth && tx.billMonth !== tx.occurredOn.slice(0, 7) ? `${monthName(tx.billMonth, 'short')} bill` : null;
}

export type RowType = 'expense' | 'income' | 'transfer' | 'opening' | 'correction' | 'debt';

export interface ListRow {
  kind: 'tx' | 'draft';
  id: string;
  /** YYYY-MM-DD, or '' for a draft whose date could not be read yet. */
  date: string;
  description: string;
  amountMinor: number;
  currency: string;
  /** The amount in the workspace's own currency, which is what a day or a filter adds up. */
  baseMinor: number;
  /**
   * What of this row is spending and what is income, in the workspace's currency — the figures every total reads.
   * For an expense or an income they are its `baseMinor`. A row of another kind can carry some of either: a loan put
   * on a card with a fee is not spending, but its fee is; a repayment is not income, but its interest is. Counting
   * those parts is what keeps the list's totals equal to the chart's.
   */
  spentMinor: number;
  earnedMinor: number;
  type: RowType;
  categoryId: string | null;
  categoryName: string | null;
  parentName: string | null;
  accountIds: string[];
  /** "BCA Tahapan", or "BCA Tahapan → BCA KrisFlyer" for money moving between two accounts. */
  accountLabel: string;
  cardId: string | null;
  last4: string | null;
  holderName: string | null;
  deleted: boolean;
  /** Marked "not my spending": still listed, faded and struck through, but out of every figure the list adds up. */
  excluded: boolean;
  /** What a draft still needs before it can be recorded. Always empty for a recorded row. */
  needs: string[];
  /** Money back on a purchase: an expense whose category took money back (a negative `amountMinor`). */
  refund?: boolean;
  /** A row with a person whose money came in: one paying back, or lending. Money in, but not income. */
  moneyIn?: boolean;
  /** Saved with its category left for later, so it is filed under Uncategorised until one is chosen. */
  needsCategory?: boolean;
  tx?: TransactionView;
  draft?: DraftRow;
}

export interface ListFilters {
  q: string;
  /** '' for any, `acct:<id>` for an account with all its cards, `card:<id>` for one card. */
  paid: string;
  /** '' for any; a category includes everything filed under it. */
  cat: string;
  type: 'all' | 'expense' | 'income' | 'transfer';
  /** The period on show: 'all', YYYY-MM, or any other period. Recorded rows are already loaded for it; drafts are filtered here. */
  month: string;
  showDeleted: boolean;
  onlyDrafts: boolean;
  /** Only what was saved under Uncategorised and still waits for a category. */
  needsCategory?: boolean;
  /**
   * Opening balances and what was owned before the app (a past purchase) are how the books were started, not money that
   * moved: hidden unless asked for, so the month's spending is not buried under them.
   */
  showOpening?: boolean;
}

export const EMPTY_FILTERS: ListFilters = { q: '', paid: '', cat: '', type: 'all', month: 'all', showDeleted: false, onlyDrafts: false, needsCategory: false };

export interface Sort {
  key: 'date' | 'amount';
  dir: 'asc' | 'desc';
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parentNameOf(categoryId: string | null, byId: Map<string, AccountRow>): string | null {
  const category = categoryId ? byId.get(categoryId) : undefined;
  return category?.parentId ? (byId.get(category.parentId)?.name ?? null) : null;
}

/** What a draft still needs, in the order a person would fill the row in. */
export function draftNeeds(draft: DraftRow): string[] {
  const needs: string[] = [];
  if (!ISO.test(draft.occurredOn)) needs.push('date');
  if (!draft.description.trim()) needs.push('description');
  if (!(draft.amountMinor > 0)) needs.push('amount');
  if (!draft.accountId) needs.push('paid with');
  if (!draft.categoryAccountId) needs.push('category');
  return needs;
}

export function buildRows(
  txs: readonly TransactionView[],
  drafts: readonly DraftRow[],
  accounts: readonly AccountRow[],
  cards: readonly CardRow[],
  /** The last four digits of each digital wallet's phone number, by account (`listWalletLast4`). */
  walletLast4: Readonly<Record<string, string>> = {},
): ListRow[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  // Archived cards included (`listCards`'s `withArchived`): a row that named a card since put away still reads its digits.
  const cardById = new Map(cards.map((card) => [card.id, card]));
  /*
   * The digits a row names when it names no card: a credit card account's only card in use — Paid with offers that card
   * as the account itself, so a purchase on it records no card — and a wallet's phone number. An account with two cards
   * and no card named was paid "from the account", and a bank is not its debit card, so neither gets any. Only a row paid
   * from that one account and nothing else: money moving between two names both, and digits after both would say neither.
   * A row that names a card is that card's alone, even one this list does not know: never another card's digits.
   */
  const cardsOf = new Map<string, CardRow[]>();
  for (const card of cards) if (!card.archived) cardsOf.set(card.accountId, [...(cardsOf.get(card.accountId) ?? []), card]);
  const soleCard = (accountId: string) => {
    const own = cardsOf.get(accountId) ?? [];
    return byId.get(accountId)?.subtype === 'credit_card' && own.length === 1 ? own[0]!.last4 : null;
  };
  const digitsOf = (cardId: string | null, accountIds: readonly string[]) => {
    if (cardId) return cardById.get(cardId)?.last4 ?? null;
    return accountIds.length === 1 ? (soleCard(accountIds[0]!) ?? walletLast4[accountIds[0]!] ?? null) : null;
  };
  const isPerson = (id: string) => ['receivable', 'payable'].includes(byId.get(id)?.subtype ?? '');

  // A statement check's "Payments not tracked" adjustment (statement-check spec §3.6) is the card's business alone: it
  // shows in the card's statement list, never here. Known by its description and its balance-correction equity side.
  const quiet = (tx: TransactionView) =>
    tx.description.startsWith('Payments not tracked (') &&
    tx.entries.some((e) => (e.accountSystemKey ?? byId.get(e.accountId)?.systemKey) === 'balance_correction');

  const recorded = txs.filter((tx) => !quiet(tx)).map((tx): ListRow => {
    const c = classify(tx);
    const categoryId = c.categoryIds[0] ?? null;
    const card = tx.cardId ? cardById.get(tx.cardId) : undefined;
    const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
    const accountIds = [...new Set(money.map((e) => e.accountId))];
    const type: RowType = tx.entries.some((e) => isPerson(e.accountId)) ? 'debt' : c.type;
    // Signed, so money back on a purchase (a refund credits its category) takes away from spending rather than adding to it.
    const baseOf = (kind: 'expense' | 'income') => (kind === 'expense' ? 1 : -1) * tx.entries.filter((e) => e.accountKind === kind).reduce((sum, e) => sum + e.amountBaseMinor, 0) || 0;
    return {
      kind: 'tx',
      id: tx.id,
      date: tx.occurredOn,
      description: tx.description,
      amountMinor: c.amountMinor,
      currency: c.currency,
      baseMinor: type === 'expense' || type === 'income' ? baseOf(type) : 0,
      spentMinor: type === 'expense' || type === 'debt' ? baseOf('expense') : 0,
      earnedMinor: type === 'income' || type === 'debt' ? baseOf('income') : 0,
      type,
      categoryId,
      categoryName: categoryId ? (byId.get(categoryId)?.name ?? null) : null,
      parentName: parentNameOf(categoryId, byId),
      accountIds,
      accountLabel: c.moneyAccountNames.join(' → '),
      cardId: tx.cardId,
      last4: digitsOf(tx.cardId, accountIds),
      holderName: card?.holderName ?? null,
      deleted: tx.status === 'void',
      excluded: tx.excluded ?? false,
      needs: [],
      refund: c.type === 'expense' && c.amountMinor < 0,
      moneyIn: type === 'debt' && money.filter((e) => !isPerson(e.accountId)).reduce((sum, e) => sum + e.amountBaseMinor, 0) > 0,
      needsCategory: c.categoryIds.some((id) => isUncategorisedKey(byId.get(id)?.systemKey)),
      tx,
    };
  });

  const pending = drafts.map((draft): ListRow => {
    const card = draft.cardId ? cardById.get(draft.cardId) : undefined;
    return {
      kind: 'draft',
      id: draft.id,
      date: ISO.test(draft.occurredOn) ? draft.occurredOn : '',
      description: draft.description,
      amountMinor: draft.amountMinor > 0 ? draft.amountMinor : 0,
      currency: draft.currency,
      baseMinor: 0,
      spentMinor: 0,
      earnedMinor: 0,
      type: 'expense',
      categoryId: draft.categoryAccountId,
      categoryName: draft.categoryAccountId ? (byId.get(draft.categoryAccountId)?.name ?? null) : null,
      parentName: parentNameOf(draft.categoryAccountId, byId),
      accountIds: draft.accountId ? [draft.accountId] : [],
      accountLabel: draft.accountId ? (byId.get(draft.accountId)?.name ?? '') : '',
      cardId: draft.cardId,
      last4: digitsOf(draft.cardId, draft.accountId ? [draft.accountId] : []),
      holderName: card?.holderName ?? null,
      deleted: false,
      // Nothing is excluded until it is recorded: a draft counts nothing either way.
      excluded: false,
      needs: draftNeeds(draft),
      draft,
    };
  });

  return [...pending, ...recorded];
}

function withinCategory(categoryId: string | null, wanted: string, byId: Map<string, AccountRow>): boolean {
  const seen = new Set<string>();
  for (let current = categoryId ? byId.get(categoryId) : undefined; current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
    if (current.id === wanted) return true;
    seen.add(current.id);
  }
  return false;
}

export function filterRows(rows: readonly ListRow[], f: ListFilters, accounts: readonly AccountRow[]): ListRow[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return rows.filter((row) => {
    if (f.onlyDrafts && row.kind !== 'draft') return false;
    if (row.deleted && !f.showDeleted) return false;
    if (row.type === 'opening' && !f.showOpening) return false;
    // A draft with no date yet is never hidden by the month it cannot be placed in, and asking for
    // what is not recorded shows all of it, whichever month it belongs to.
    if (f.month !== 'all' && !f.onlyDrafts && row.date) {
      const period = parsePeriod(f.month);
      if (period?.from && (row.date < period.from || row.date > period.to!)) return false;
    }
    if (f.type === 'expense' && row.type !== 'expense') return false;
    if (f.type === 'income' && row.type !== 'income') return false;
    if (f.type === 'transfer' && !['transfer', 'debt', 'opening', 'correction'].includes(row.type)) return false;
    if (f.cat && !withinCategory(row.categoryId, f.cat, byId)) return false;
    if (f.needsCategory && !row.needsCategory) return false;
    if (f.paid.startsWith('card:') && row.cardId !== f.paid.slice(5)) return false;
    if (f.paid.startsWith('acct:') && !row.accountIds.includes(f.paid.slice(5))) return false;
    return matchesSearch(
      { text: [row.description, row.categoryName, row.parentName, row.accountLabel, row.holderName], amountMinor: row.amountMinor, last4: row.last4 },
      f.q,
    );
  });
}

export function sortRows(rows: readonly ListRow[], sort: Sort): ListRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  // An undated draft sorts as the newest thing there is, so it sits at the top where it will be seen.
  const dateOf = (row: ListRow) => row.date || '9999-12-31';
  return [...rows].sort(
    (a, b) =>
      (sort.key === 'amount' ? a.amountMinor - b.amountMinor : dateOf(a).localeCompare(dateOf(b))) * dir ||
      (a.kind === b.kind ? 0 : a.kind === 'draft' ? -1 : 1) ||
      // By date, a day reads in the order its rows were moved to by hand, whichever way the days run (the db's rule).
      (sort.key === 'date' && a.tx && b.tx
        ? compareWithinDay(a.tx, b.tx)
        : (b.tx?.createdAt ?? '').localeCompare(a.tx?.createdAt ?? '')),
  );
}

/** Consecutive rows grouped by their date, keeping the order they arrive in. */
export function groupByDay(rows: readonly ListRow[]): { date: string; rows: ListRow[] }[] {
  const days: { date: string; rows: ListRow[] }[] = [];
  for (const row of rows) {
    const last = days[days.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else days.push({ date: row.date, rows: [row] });
  }
  return days;
}

/** A category and everything filed under it in the list, largest first. */
export interface CategoryGroup {
  /** The category's account id, or null for rows that have none: transfers, and drafts not yet filed. */
  id: string | null;
  name: string;
  rows: ListRow[];
  /** What the category came to in the workspace's own currency. Transfers and deleted rows count nothing. */
  totalMinor: number;
}

/**
 * The same rows, gathered by what they were spent on rather than when.
 *
 * Only spending and income carry a category, so transfers and unfiled drafts gather under one heading of
 * their own rather than being dropped: a list that quietly loses rows cannot be trusted to add up.
 */
export function groupByCategory(rows: readonly ListRow[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const row of rows) {
    const id = row.categoryId;
    const spending = row.type === 'expense' || row.type === 'income' || row.spentMinor + row.earnedMinor > 0;
    // A transfer is not uncategorised spending: money moved without being spent, so it keeps its own heading.
    const key = id ?? (spending ? 'uncategorised' : 'other');
    const name = row.categoryName ?? (spending ? 'Uncategorised' : 'Transfers and other');
    const group = groups.get(key) ?? { id, name, rows: [], totalMinor: 0 };
    group.rows.push(row);
    // A transfer moves money without spending it, and a deleted row was never real.
    // …and a row marked "not my spending" keeps its place in the group while adding nothing to its figure.
    if (!row.deleted && !row.excluded) group.totalMinor += row.spentMinor + row.earnedMinor;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
}

/** A day's net in the workspace currency: income less spending, never counting drafts, deleted rows or transfers. */
/**
 * How a row's figure reads: a sign for its colour (red out, green in), a plus, and muted. A row with a person reads by
 * what it holds: a purchase split with someone is spending (its own share, red), money a person paid back is money in
 * with a plus but muted, since it is not income and adds nothing to the day, and money lent out stays plain.
 */
export function amountLook(row: ListRow): { sign: -1 | 0 | 1; plus: boolean; muted: boolean } {
  if (row.refund) return { sign: 1, plus: true, muted: false };
  if (row.type === 'expense') return { sign: -1, plus: false, muted: false };
  if (row.type === 'income') return { sign: 1, plus: false, muted: false };
  if (row.type === 'debt' && row.spentMinor > 0) return { sign: -1, plus: false, muted: false };
  if (row.type === 'debt' && row.earnedMinor > 0) return { sign: 1, plus: false, muted: false };
  if (row.moneyIn) return { sign: 0, plus: true, muted: true };
  return { sign: 0, plus: false, muted: false };
}

/**
 * How a row names what paid, on its second line. A card whose last four digits are known is those digits alone —
 * "4417", bold, says which card more surely than a long account name, and leaves the line room for the note. Money moving
 * between two accounts ("BCA Tahapan → CIMB Octo") keeps both names, with the digits after them as before.
 */
export function paidWithLook(row: Pick<ListRow, 'accountLabel' | 'accountIds' | 'last4'>): { name: string; last4: string | null } {
  if (row.last4 && row.accountIds.length <= 1) return { name: '', last4: row.last4 };
  return { name: row.accountLabel, last4: row.last4 };
}

/** One piece of the line under a row's amount: what it cost in the currency it was charged in, or the points it earned. */
export interface AmountExtraPart {
  text: string;
  /** `foreign` reads muted; points read green when earned and red when taken back. */
  tone: 'foreign' | 'earned' | 'lost';
}

/**
 * The one line under a row's amount: the foreign amount first, then the points ("¥1.850 · +38 pts"), either alone when
 * only one applies, and nothing when neither does. Both used to stack as lines of their own, which made a foreign
 * purchase on a card that earns three lines tall.
 */
export function amountExtraParts(
  tx: Pick<TransactionView, 'originalCurrency' | 'originalAmountMinor'>,
  points: PurchasePoints | undefined,
): AmountExtraPart[] {
  const parts: AmountExtraPart[] = [];
  if (tx.originalCurrency && tx.originalAmountMinor !== null) parts.push({ text: formatMinor(tx.originalAmountMinor, tx.originalCurrency), tone: 'foreign' });
  if (points) {
    const mark = points.points < 0 ? '−' : points.approximate ? '≈ ' : '+';
    parts.push({ text: `${mark}${formatPoints(Math.abs(points.points))} ${points.unit}`, tone: points.points < 0 ? 'lost' : 'earned' });
  }
  return parts;
}

export function dayTotal(rows: readonly ListRow[]): number {
  const counted = (row: ListRow) => row.kind === 'tx' && !row.deleted && !row.excluded;
  return dayNet(
    rows.flatMap((row) => [
      { kind: 'income' as const, amountMinor: row.earnedMinor, counted: counted(row) },
      { kind: 'expense' as const, amountMinor: row.spentMinor, counted: counted(row) },
    ]),
  );
}

export function totals(rows: readonly ListRow[]): { count: number; spentMinor: number; incomeMinor: number } {
  const counted = rows.filter((row) => row.kind === 'tx' && !row.deleted && !row.excluded);
  return {
    count: counted.length,
    spentMinor: counted.reduce((sum, row) => sum + row.spentMinor, 0),
    incomeMinor: counted.reduce((sum, row) => sum + row.earnedMinor, 0),
  };
}
