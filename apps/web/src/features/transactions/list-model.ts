import { dayNet, matchesSearch } from '@expanses/core';
import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { classify } from './classify';

/**
 * The transactions list as data: recorded transactions and drafts not yet recorded, in one shape, so
 * search, filters, sorting, days and totals treat both the same way and can be tested without a page.
 */

export type RowType = 'expense' | 'income' | 'transfer' | 'opening' | 'debt';

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
  /** What a draft still needs before it can be recorded. Always empty for a recorded row. */
  needs: string[];
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
  /** 'all', or YYYY-MM. Recorded rows are already loaded for the month; drafts are filtered here. */
  month: string;
  showDeleted: boolean;
  onlyDrafts: boolean;
}

export const EMPTY_FILTERS: ListFilters = { q: '', paid: '', cat: '', type: 'all', month: 'all', showDeleted: false, onlyDrafts: false };

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
): ListRow[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const isPerson = (id: string) => ['receivable', 'payable'].includes(byId.get(id)?.subtype ?? '');

  const recorded = txs.map((tx): ListRow => {
    const c = classify(tx);
    const categoryId = c.categoryIds[0] ?? null;
    const card = tx.cardId ? cardById.get(tx.cardId) : undefined;
    const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
    const type: RowType = tx.entries.some((e) => isPerson(e.accountId)) ? 'debt' : c.type;
    const baseOf = (kind: 'expense' | 'income') => Math.abs(tx.entries.filter((e) => e.accountKind === kind).reduce((sum, e) => sum + e.amountBaseMinor, 0));
    return {
      kind: 'tx',
      id: tx.id,
      date: tx.occurredOn,
      description: tx.description,
      amountMinor: c.amountMinor,
      currency: c.currency,
      baseMinor: type === 'expense' || type === 'income' ? baseOf(type) : 0,
      type,
      categoryId,
      categoryName: categoryId ? (byId.get(categoryId)?.name ?? null) : null,
      parentName: parentNameOf(categoryId, byId),
      accountIds: [...new Set(money.map((e) => e.accountId))],
      accountLabel: c.moneyAccountNames.join(' → '),
      cardId: tx.cardId,
      last4: card?.last4 ?? null,
      holderName: card?.holderName ?? null,
      deleted: tx.status === 'void',
      needs: [],
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
      type: 'expense',
      categoryId: draft.categoryAccountId,
      categoryName: draft.categoryAccountId ? (byId.get(draft.categoryAccountId)?.name ?? null) : null,
      parentName: parentNameOf(draft.categoryAccountId, byId),
      accountIds: draft.accountId ? [draft.accountId] : [],
      accountLabel: draft.accountId ? (byId.get(draft.accountId)?.name ?? '') : '',
      cardId: draft.cardId,
      last4: card?.last4 ?? null,
      holderName: card?.holderName ?? null,
      deleted: false,
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
    // A draft with no date yet is never hidden by the month it cannot be placed in, and asking for
    // what is not recorded shows all of it, whichever month it belongs to.
    if (f.month !== 'all' && !f.onlyDrafts && row.date && !row.date.startsWith(f.month)) return false;
    if (f.type === 'expense' && row.type !== 'expense') return false;
    if (f.type === 'income' && row.type !== 'income') return false;
    if (f.type === 'transfer' && !['transfer', 'debt', 'opening'].includes(row.type)) return false;
    if (f.cat && !withinCategory(row.categoryId, f.cat, byId)) return false;
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
      (b.tx?.createdAt ?? '').localeCompare(a.tx?.createdAt ?? ''),
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

/** A day's net in the workspace currency: income less spending, never counting drafts, deleted rows or transfers. */
export function dayTotal(rows: readonly ListRow[]): number {
  return dayNet(rows.map((row) => ({ kind: row.type === 'expense' || row.type === 'income' ? row.type : 'transfer', amountMinor: row.baseMinor, counted: row.kind === 'tx' && !row.deleted })));
}

export function totals(rows: readonly ListRow[]): { count: number; spentMinor: number; incomeMinor: number } {
  const counted = rows.filter((row) => row.kind === 'tx' && !row.deleted);
  return {
    count: counted.length,
    spentMinor: counted.filter((row) => row.type === 'expense').reduce((sum, row) => sum + row.baseMinor, 0),
    incomeMinor: counted.filter((row) => row.type === 'income').reduce((sum, row) => sum + row.baseMinor, 0),
  };
}
