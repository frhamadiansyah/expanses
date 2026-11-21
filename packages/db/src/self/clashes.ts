import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * Link my devices, rule 5 (spec §3.3): two devices made "the same" row under different ids, and a unique key says there
 * can be only one. Each unique key has one fixed answer, the same on every device. **A clash never deletes a
 * transaction, an entry, a split, a payment or any row money hangs on, and never removes children.**
 *
 * - `merge`: settings-like rows that hold no money. One row stays under the earlier id; each column takes the later
 *   value of the two; the other row's children (`children`: table and column) are moved onto it; only the other row
 *   itself goes, its id kept as an alias.
 * - `keep-both`: each row is a real record and the key is only a "seen before" mark: both stay, the later row's key
 *   column (`clear`) is emptied, and the Activity says it may be a duplicate.
 * - `hold`: money, or rows money hangs on. The change waits, like a change from a newer version (rule 6), and the
 *   Devices screen names both rows; nothing on this device changes until one of them does.
 *
 * Keys are named `table:col,col` — an inline UNIQUE has no stable index name of its own.
 */

export type ClashRule =
  | { answer: 'merge'; children?: readonly (readonly [table: string, column: string])[] }
  | { answer: 'keep-both'; clear: string }
  | { answer: 'hold'; why: string };

export const CLASH_RULES: Readonly<Record<string, ClashRule>> = {
  'budgets:workspace_id,category_account_id': {
    answer: 'merge',
    children: [
      ['budget_overrides', 'budget_id'],
      ['budget_frequencies', 'budget_id'],
      ['budget_shares', 'budget_id'],
    ],
  },
  'budget_overrides:budget_id,month': { answer: 'merge' },
  'merchant_mccs:workspace_id,pattern': { answer: 'merge' },
  'income_sources:workspace_id,account_id': { answer: 'merge' },
  'draft_transactions:workspace_id,external_ref': { answer: 'keep-both', clear: 'external_ref' },
  'transactions:workspace_id,external_ref': { answer: 'keep-both', clear: 'external_ref' },
  'accounts:workspace_id,system_key': { answer: 'hold', why: 'a system account holds entries' },
  'asset_sales:account_id': { answer: 'hold', why: 'a sale posts a transaction' },
  'deposit_events:account_id,kind,due_on': { answer: 'hold', why: 'an event posts interest and principal' },
  'securities:workspace_id,market,ticker': { answer: 'hold', why: 'trades and prices hang on it' },
  'tax_year_reports:workspace_id,tax_year': { answer: 'hold', why: 'a frozen or filed report and its rows' },
  'statement_checks:card_account_id,period_start,period_end': { answer: 'hold', why: 'its links would go with it' },
  // Seat-owned: one writer, so two rows under one key is a fault, never something to settle by itself.
  'book_member_accounts:book_id,member_id,currency': { answer: 'hold', why: 'household bookkeeping' },
  'event_books:event_id': { answer: 'hold', why: 'household bookkeeping' },
  'event_category_accounts:account_id': { answer: 'hold', why: 'household bookkeeping' },
  'group_logs:group_book_id': { answer: 'hold', why: 'household bookkeeping' },
  'nw_item_map:item_id': { answer: 'hold', why: 'household bookkeeping' },
};

export interface UniqueKey {
  /** `table:col,col`, the key of `CLASH_RULES`. */
  id: string;
  columns: string[];
  /** A partial index's condition, as SQL over the table's own column names; null for a whole one. */
  where: string | null;
}

/** The unique keys of a table other than its primary key, read from the live schema. */
export async function uniqueKeysOf(db: Db, table: string): Promise<UniqueKey[]> {
  const indexes = await db.values<[string, string, number]>(sql`SELECT name, origin, partial FROM pragma_index_list(${table}) WHERE "unique" = 1 AND origin <> 'pk'`);
  const keys: UniqueKey[] = [];
  for (const [name, , partial] of indexes) {
    const columns = (await db.values<[string]>(sql`SELECT name FROM pragma_index_info(${name}) ORDER BY seqno`)).map(([column]) => column);
    let where: string | null = null;
    if (Number(partial) === 1) {
      const [row] = await db.values<[string]>(sql`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ${name}`);
      const text = row?.[0] ?? '';
      const at = text.search(/\bWHERE\b/i);
      where = at >= 0 ? text.slice(at + 5).trim() : null;
    }
    keys.push({ id: `${table}:${columns.join(',')}`, columns, where });
  }
  return keys;
}

/** A write refused by a unique key — the query layer wraps SQLite's own error, so its causes are read too. */
export function isUniqueFailure(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth += 1) {
    const text = e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : String(e);
    if (/SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint failed/.test(text)) return true;
  }
  return false;
}
