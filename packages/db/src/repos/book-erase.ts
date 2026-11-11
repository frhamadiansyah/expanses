import { type SQL, sql } from 'drizzle-orm';
import { inBook, type WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { capturePostedTx, withCaptureSuspended } from '../sync/capture';
import { HELD_PREFIX } from '../sync/held';
import { endSharedGoalsTx, hasOwnPartTx } from '../sync/goals/follow';
import { createAccountTx } from './accounts';
import { inputOfTx } from './activity';
import { BookError, personalBookIdTx, type BookKind } from './books';
import { healthTablesExist } from './health-tables';
import { eraseVoidTransactionsTx, LedgerError, refileInPlaceTx, rekeyTransactionTx, replaceTransactionTx, voidTransactionTx } from './ledger';
import { categoryInBookTx } from './move-group';
import { deleteGoalRowsTx } from './goals';

/*
 * Deleting a workspace that is or was shared ERASES what belongs only to it (sharing resilience spec §5), where a
 * never-shared one is voided (`book-delete.ts`). Its ids live on in the partners' copies and on the relay's log: voided
 * rows and archived categories left here would stand in the way of the same workspace being shared to this phone again.
 *
 * "Only it": decided by book scoping, never by names. A transaction is the book's when it is filed in it (its row, a
 * split's part, a line on one of its categories) or is the row one of its purchase lineages holds here (head, last
 * head), with every void version of it (the `replaces_transaction_id` chain, both ways) — unless it is filed in
 * another book too: that one stays. A row that only shares its id with a lineage (a remapped purchase's holder) or only
 * touches a placeholder (a transfer between partners) is not the book's. A transaction a record the erase cannot take
 * still names (a trade, a sale, a partner transfer) refuses the delete. A category is the book's when `book_categories`
 * puts it there; a placeholder when `book_member_accounts` does; a goal when this book's `goal_shares` shared it in.
 * A category still named by anything left (another book's event) loses only its tag and is archived; a placeholder
 * still named (a partner transfer) is left as it is. Every other account (bank, card, wallet, joint) is never
 * touched, and its balance changes only by the erased transactions, exactly as voiding them changes it.
 *
 * Children go before parents throughout: foreign keys are on.
 */

async function tablesOf(tx: Db): Promise<Set<string>> {
  return new Set((await tx.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(([name]) => name));
}

/** The member this phone is in the book: its share's, or the one remembered after the share went (C1). */
async function memberHereTx(tx: Db, bookId: string, tables: Set<string>): Promise<string | null> {
  if (tables.has('shared_books')) {
    const [row] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
    if (row) return row[0];
  }
  const [remembered] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${`sharing.member.${bookId}`}`);
  return remembered?.[0] ?? null;
}

/**
 * Whether the book is or was shared (D-A9): a joined copy (`kind = 'shared'`), a `shared_books` row in any state, a
 * remembered member, or a purchase lineage of it. Deleting such a book erases; any other is voided.
 */
export async function wasEverSharedTx(tx: Db, bookId: string, kind: BookKind): Promise<boolean> {
  if (kind === 'shared') return true;
  const tables = await tablesOf(tx);
  if (tables.has('shared_books') && (await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId}`)).length > 0) return true;
  if ((await tx.values(sql`SELECT 1 FROM settings WHERE key = ${`sharing.member.${bookId}`}`)).length > 0) return true;
  return tables.has('sync_lineage') && (await tx.values(sql`SELECT 1 FROM sync_lineage WHERE book_id = ${bookId} LIMIT 1`)).length > 0;
}

/** `wasEverSharedTx` for a book of the workspace, read on its own. */
export async function wasEverShared(database: Database, ws: WorkspaceContext, bookId: string): Promise<boolean> {
  const [row] = await database.db.values<[BookKind]>(sql`SELECT kind FROM books WHERE id = ${bookId} AND workspace_id = ${ws.workspaceId}`);
  if (!row) throw new BookError('NOT_FOUND', 'That workspace is not here');
  return wasEverSharedTx(database.db, bookId, row[0]);
}

/** The posted transactions filed in the book, by its row, a split's part, or an entry on one of its categories. */
function filedSql(bookId: string, tables: Set<string>, status: SQL = sql`t.status = 'posted'`): SQL {
  const own = sql`SELECT category_account_id FROM book_categories WHERE book_id = ${bookId}`;
  const parts = tables.has('book_transaction_splits') ? sql` OR t.id IN (SELECT transaction_id FROM book_transaction_splits WHERE book_id = ${bookId})` : sql``;
  return sql`SELECT t.id FROM transactions t WHERE ${status} AND (
    t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})${parts}
    OR t.id IN (SELECT e.transaction_id FROM entries e WHERE e.account_id IN (${own}) OR e.spend_category_id IN (${own})))`;
}

/** The tables this database has, as the erase reads them (a database from before a migration lacks some). */
export function erasableTablesTx(tx: Db): Promise<Set<string>> {
  return tablesOf(tx);
}

/**
 * A share's purchase on a category this copy holds (A6 fix rounds 3 and 4): the head of a purchase lineage of another
 * book that still exists here, filed in that book (as apply files every purchase a share sends), with no split part in
 * this one. It is that share's, whatever its category's tag says. A real split across this book and another is not.
 */
export function anotherSharesSql(bookId: string, tables: Set<string>): SQL {
  if (!tables.has('sync_lineage')) return sql`0`;
  const notSplitHere = tables.has('book_transaction_splits')
    ? sql`AND NOT EXISTS (SELECT 1 FROM book_transaction_splits sp WHERE sp.transaction_id = t.id AND sp.book_id = ${bookId})`
    : sql``;
  return sql`EXISTS (SELECT 1 FROM sync_lineage l WHERE l.head_transaction_id = t.id AND l.book_id <> ${bookId}
      AND (l.book_id IN (SELECT id FROM books)${tables.has('shared_books') ? sql` OR l.book_id IN (SELECT book_id FROM shared_books)` : sql``})
      AND EXISTS (SELECT 1 FROM book_transactions f WHERE f.transaction_id = t.id AND f.book_id = l.book_id)
      ${notSplitHere})`;
}

/**
 * Rows of a transaction that `ws`'s other book names it by: another book's row, split part, or category on a line, or
 * a share's purchase on a category this copy holds (`anotherSharesSql`).
 */
function elsewhereSql(bookId: string, tables: Set<string>): SQL {
  const otherLineage = sql`OR ${anotherSharesSql(bookId, tables)}`;
  return sql`(EXISTS (SELECT 1 FROM book_transactions b WHERE b.transaction_id = t.id AND b.book_id <> ${bookId})
    ${tables.has('book_transaction_splits') ? sql`OR EXISTS (SELECT 1 FROM book_transaction_splits s WHERE s.transaction_id = t.id AND s.book_id <> ${bookId})` : sql``}
    ${otherLineage}
    OR EXISTS (SELECT 1 FROM entries e JOIN book_categories c ON c.category_account_id IN (e.account_id, e.spend_category_id)
               WHERE e.transaction_id = t.id AND c.book_id <> ${bookId}))`;
}

/**
 * The book's transactions (spec §5.2 item 1), as a read: every one filed in it, whatever its status, and the rows its
 * purchase lineages hold here (their heads and last heads), with every void version of each along
 * `replaces_transaction_id`, both ways. Never one filed in another book too. Never a row that only shares its id with a
 * lineage (a remapped purchase's holder, D-A2), nor one that only touches a placeholder (a transfer between partners,
 * which belongs to the net-worth group log): neither is the book's. A posted row joins only as a seed, so a live row
 * reached through a chain is never taken.
 */
function eraseSetSql(ws: WorkspaceContext, bookId: string, tables: Set<string>): SQL {
  const elsewhere = elsewhereSql(bookId, tables);
  const seeds: SQL[] = [sql`t.id IN (${filedSql(bookId, tables, sql`1 = 1`)})`];
  if (tables.has('sync_lineage')) {
    seeds.push(sql`t.id IN (SELECT head_transaction_id FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IS NOT NULL)`);
    if (tables.has('sync_lineage_last')) {
      seeds.push(sql`t.id IN (SELECT l.transaction_id FROM sync_lineage_last l JOIN sync_lineage s ON s.lineage_id = l.lineage_id WHERE s.book_id = ${bookId})`);
    }
  }
  const step = sql`t.workspace_id = ${ws.workspaceId} AND t.status <> 'posted' AND NOT ${elsewhere}`;
  return sql`WITH RECURSIVE erase(id) AS (
      SELECT t.id FROM transactions t WHERE t.workspace_id = ${ws.workspaceId} AND (${sql.join(seeds, sql` OR `)}) AND NOT ${elsewhere}
      UNION SELECT t.id FROM transactions t JOIN erase x ON t.replaces_transaction_id = x.id WHERE ${step}
      UNION SELECT t.id FROM erase x JOIN transactions r ON r.id = x.id JOIN transactions t ON t.id = r.replaces_transaction_id WHERE ${step}
    ) SELECT id FROM erase`;
}

/** Rows that belong to a transaction and go with it (column naming the transaction). */
const GOES_WITH_TRANSACTION: readonly [table: string, column: string][] = [
  ['transaction_flags', 'transaction_id'],
  ['bill_payments', 'transaction_id'],
  ['transaction_line_excluded', 'transaction_id'],
  ['transaction_photos', 'transaction_id'],
  ['book_transactions', 'transaction_id'],
  ['book_transaction_splits', 'transaction_id'],
  ['card_postings', 'transaction_id'],
  ['card_installments', 'transaction_id'],
  ['card_settlements', 'purchase_transaction_id'],
  ['card_settlements', 'payment_transaction_id'],
  ['transaction_point_actuals', 'transaction_id'],
  ['point_entries', 'transaction_id'],
  ['statement_links', 'transaction_id'],
  ['card_fee_refunds', 'transaction_id'],
  ['event_item_purchases', 'transaction_id'],
  ['goal_draws', 'transaction_id'],
  ['sync_lineage_last', 'transaction_id'],
  ['fx_gain_loss', 'transaction_id'],
];

/** References to a transaction that are cleared rather than taken with it: the row that named it stays. */
const CLEARED_WITH_TRANSACTION: readonly [table: string, column: string, also?: string][] = [
  ['transactions', 'replaces_transaction_id'],
  ['draft_transactions', 'transaction_id'],
  ['event_items', 'transaction_id', 'share_minor'],
  ['deposit_events', 'interest_transaction_id'],
  ['deposit_events', 'principal_transaction_id'],
  ['event_postings', 'transaction_id'],
  ['shared_transfers', 'transaction_id'],
];

/** The records of this phone's own money that name a transaction and keep it (never synced: always this member's). */
const OWN_RECORDS: ReadonlySet<string> = new Set(['investment_trades.transaction_id', 'asset_sales.transaction_id']);

export interface KeptByRecords {
  /** Named only by a trade or a sale of this phone's own (`OWN_RECORDS`): re-filed into Personal in place when kept. */
  own: string[];
  /** Named by any other record (a transfer between partners' posting, a table added later): never taken. */
  other: string[];
}

/**
 * The book's transactions that a record this erase does not take still names — a trade, a sale of an asset, a
 * transfer between partners' posting, or any table added later that names a transaction (found by foreign key and
 * column name). Erasing would leave that record pointing at nothing, and voiding it and keeping it would keep an id
 * that stands in a later share's way. From a read-only joined copy a trade's or sale's is kept in Personal in place
 * (`refileRecordsInPersonalTx`); anything else refuses the delete (`RECORDS`), with nothing changed.
 */
export async function keptByRecordsTx(tx: Db, ws: WorkspaceContext, bookId: string, tables?: Set<string>): Promise<KeptByRecords> {
  const known = tables ?? (await tablesOf(tx));
  const handled = new Set([
    ...[...GOES_WITH_TRANSACTION, ...CLEARED_WITH_TRANSACTION].map(([t, c]) => `${t}.${c}`),
    'entries.transaction_id',
    'sync_lineage.head_transaction_id',
  ]);
  const own = new Set<string>();
  const other = new Set<string>();
  for (const [table, column] of await referencesTo(tx, known, 'transactions')) {
    if (handled.has(`${table}.${column}`)) continue;
    const rows = await tx.values<[string]>(
      sql`SELECT DISTINCT ${sql.raw(column)} FROM ${sql.raw(table)} WHERE ${sql.raw(column)} IN (${eraseSetSql(ws, bookId, known)})`,
    );
    for (const [id] of rows) (OWN_RECORDS.has(`${table}.${column}`) ? own : other).add(id);
  }
  return { own: [...own].filter((id) => !other.has(id)).sort(), other: [...other].sort() };
}

/** A joined copy that has left its share here (`unshared`): read-only, so nothing in it can be undone or moved first. */
export async function readOnlyCopyTx(tx: Db, bookId: string, kind: BookKind): Promise<boolean> {
  if (kind !== 'shared' || !(await tablesOf(tx)).has('shared_books')) return false;
  const [row] = await tx.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${bookId}`);
  return row?.[0] === 'unshared';
}

/**
 * Why a delete refuses over transactions a record keeps. In a workspace that can still be changed, the way out is to
 * undo or move them. A read-only joined copy cannot be changed, so the words say it cannot be deleted yet rather than
 * ask for what the app would refuse.
 */
export function recordsMessage(count: number, readOnly = false): string {
  const what = `${count} ${count === 1 ? 'transaction' : 'transactions'} in this workspace ${count === 1 ? 'belongs' : 'belong'} to`;
  if (readOnly) return `${what} a transfer between partners or another record kept outside it, so this workspace cannot be deleted yet.`;
  return `${what} a trade, a sale or a transfer between partners. Undo or move ${count === 1 ? 'it' : 'them'} first, then delete this workspace.`;
}

/** Why a read-only copy's own trades and sales refuse a delete that would not keep them: the switch that keeps them. */
export function ownRecordsMessage(count: number): string {
  return `${count} ${count === 1 ? 'trade or sale' : 'trades or sales'} in this workspace ${count === 1 ? 'holds' : 'hold'} money of this phone's own accounts and cannot be erased. Delete it with Keep them in Personal on.`;
}

/**
 * The rows of a joined copy paid from this member's own accounts (owner decision, plan Task A5, fix round 1 I2): every
 * posted transaction the erase would take (filed in the copy, or held by one of its lineages — a purchase edited into a
 * transfer, say), with a money side and every money line on an account of this phone's own — not a placeholder
 * (another member's money), not a joint account, not paid from a partner's shared item — recorded by this member, and
 * kept by no other record. Oldest first.
 */
export async function ownPurchasesTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<string[]> {
  return (await ownPurchasesOfTx(tx, ws, bookId)).keep;
}

/**
 * The copy's own purchases (`ownPurchasesTx`'s rule), split by where they go on a delete with Keep them in Personal on
 * (A6 fix round 1, owner ruling): `arriving` are those another shared book here, active, set aside because this copy
 * held them (a `HELD_ELSEWHERE: <this copy>` skip of the purchase's lineage). Place them now brings each into that
 * share, so keeping it in Personal too would count it twice: it is erased with the copy instead. `keep` is the rest,
 * kept in Personal as before.
 */
export async function ownPurchasesOfTx(
  tx: Db,
  ws: WorkspaceContext,
  bookId: string,
): Promise<{ keep: string[]; arriving: string[]; arrivingIn: { transactionId: string; lineageId: string; shareBookId: string }[] }> {
  const own = await allOwnPurchasesTx(tx, ws, bookId);
  const tables = await tablesOf(tx);
  if (own.length === 0 || !tables.has('sync_skipped') || !tables.has('sync_lineage') || !tables.has('shared_books')) return { keep: own, arriving: [], arrivingIn: [] };
  const rows = await tx.values<[string, string, string]>(sql`
    SELECT DISTINCT l.head_transaction_id, l.lineage_id, s.book_id FROM sync_lineage l
    JOIN sync_skipped s ON s.entity = 'purchase' AND s.id = l.lineage_id AND s.error = ${`${HELD_PREFIX}: ${bookId}`}
    JOIN shared_books b ON b.book_id = s.book_id AND b.state = 'active' AND b.book_id <> ${bookId}
    WHERE l.book_id = ${bookId} AND l.head_transaction_id IN ${own}
    ORDER BY l.head_transaction_id, s.book_id`);
  const arrivingIn: { transactionId: string; lineageId: string; shareBookId: string }[] = [];
  for (const [transactionId, lineageId, shareBookId] of rows) {
    if (!arrivingIn.some((a) => a.transactionId === transactionId)) arrivingIn.push({ transactionId, lineageId, shareBookId });
  }
  const arriving = new Set(arrivingIn.map((a) => a.transactionId));
  return { keep: own.filter((id) => !arriving.has(id)), arriving: own.filter((id) => arriving.has(id)), arrivingIn };
}

/**
 * Before the erase takes them (A6 fix round 3): where each own purchase the share brings back was paid from here — its
 * own money accounts by currency, and its card — written down for that share under `sharing.arriving.<share>`, so the
 * share's Place them now lands each on exactly that account (D-B6). Local only, never sent; no migration.
 */
export async function writeArrivingTx(tx: Db, arrivingIn: readonly { transactionId: string; lineageId: string; shareBookId: string }[]): Promise<void> {
  const byShare = new Map<string, Record<string, { accountId: string; currency: string; cardId: string | null }[]>>();
  const joint = (await tablesOf(tx)).has('nw_joint_accounts');
  for (const { transactionId, lineageId, shareBookId } of arrivingIn) {
    const [card] = await tx.values<[string | null]>(sql`SELECT card_id FROM transactions WHERE id = ${transactionId}`);
    const sides = await tx.values<[string, string]>(sql`
      SELECT DISTINCT e.account_id, e.currency FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId} AND a.kind IN ('asset', 'liability')
        AND a.id NOT IN (SELECT account_id FROM book_member_accounts)
        ${joint ? sql`AND a.id NOT IN (SELECT account_id FROM nw_joint_accounts)` : sql``}
      ORDER BY e.currency, e.account_id`);
    const cardId = card?.[0] ?? null;
    const cardAccount = cardId ? (await tx.values<[string]>(sql`SELECT account_id FROM cards WHERE id = ${cardId}`))[0]?.[0] : undefined;
    const map = byShare.get(shareBookId) ?? {};
    map[lineageId] = sides.map(([accountId, currency]) => ({ accountId, currency, cardId: cardAccount === accountId ? cardId : null }));
    byShare.set(shareBookId, map);
  }
  for (const [shareBookId, map] of byShare) {
    const key = `sharing.arriving.${shareBookId}`;
    const [row] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${key}`);
    let before: Record<string, unknown> = {};
    try {
      before = row ? (JSON.parse(row[0]) as Record<string, unknown>) : {};
    } catch {
      before = {};
    }
    await tx.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify({ ...before, ...map })}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  }
}

async function allOwnPurchasesTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<string[]> {
  const tables = await tablesOf(tx);
  const me = await memberHereTx(tx, bookId, tables);
  const received = [
    ...(tables.has('book_member_accounts') ? [sql`a.id IN (SELECT account_id FROM book_member_accounts)`] : []),
    ...(tables.has('nw_joint_accounts') ? [sql`a.id IN (SELECT account_id FROM nw_joint_accounts)`] : []),
  ];
  const notReceived = received.length
    ? sql`AND NOT EXISTS (SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = t.id AND a.kind IN ('asset', 'liability') AND (${sql.join(received, sql` OR `)}))`
    : sql``;
  const byMe = tables.has('sync_lineage')
    ? sql`AND NOT EXISTS (SELECT 1 FROM sync_lineage l WHERE l.head_transaction_id = t.id
        AND (l.paid_from_owner IS NOT NULL OR ${me === null ? sql`0` : sql`l.paid_by <> ${me}`}))`
    : sql``;
  const derived = tables.has('event_postings') ? sql`AND t.id NOT IN (SELECT transaction_id FROM event_postings WHERE transaction_id IS NOT NULL)` : sql``;
  const rows = await tx.values<[string]>(sql`
    SELECT t.id FROM transactions t WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND t.id IN (${eraseSetSql(ws, bookId, tables)})
      AND EXISTS (SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.kind IN ('asset', 'liability'))
      ${notReceived} ${byMe} ${derived}
    ORDER BY t.occurred_on, t.created_at, t.id`);
  const records = await keptByRecordsTx(tx, ws, bookId, tables);
  const kept = new Set([...records.own, ...records.other]);
  return rows.map(([id]) => id).filter((id) => !kept.has(id));
}

/**
 * The copy in Personal of each of the copy's categories, made there (under its parent's copy, with its key) when
 * Personal has none; any other category as it is.
 */
async function personalCategoryOfTx(tx: Db, ws: WorkspaceContext, bookId: string, personal: string): Promise<(categoryId: string) => Promise<string>> {
  const inCopy = new Set((await tx.values<[string]>(sql`SELECT category_account_id FROM book_categories WHERE book_id = ${bookId}`)).map(([id]) => id));
  const made = new Map<string, string>();
  const there = async (categoryId: string): Promise<string> => {
    if (!inCopy.has(categoryId)) return categoryId;
    const known = made.get(categoryId) ?? (await categoryInBookTx(tx, ws, categoryId, personal));
    if (known) {
      made.set(categoryId, known);
      return known;
    }
    const [row] = await tx.values<[string, string, string | null, string | null, string | null]>(
      sql`SELECT kind, name, icon, parent_id, system_key FROM accounts WHERE id = ${categoryId}`,
    );
    const [kind, name, icon, parentId, systemKey] = row!;
    const parent = parentId ? await there(parentId) : null;
    const created = await createAccountTx(tx, inBook(ws, personal), { kind: kind as 'expense' | 'income', subtype: 'category', name, icon, currency: null, parentId: parent });
    // The key travels with it, so card earning rules read it as they read the copy's (one per book, 0043: none in Personal).
    if (systemKey) await tx.run(sql`UPDATE accounts SET system_key = ${systemKey} WHERE id = ${created.id}`);
    made.set(categoryId, created.id);
    return created.id;
  };
  return there;
}

/**
 * What the delete keeps in Personal from the copy before erasing it (owner decision; fix rounds 2 and 3), with capture
 * off only where the read-only copy is touched:
 *
 * - `purchases`, this member's own (`ownPurchasesTx`): moved as Move to workspace moves them (`replaceTransactionTx`
 *   with `moveToBook`), each category swapped for its copy in Personal. What lands there is an ordinary local purchase
 *   under a new id: it replaces nothing (the copy's row is erased) and has no lineage of the copy.
 * - `records`, the transactions this phone's own trades and sales name (`keptByRecordsTx`): re-filed in place
 *   (`refileInPlaceTx`), then given a new id (`rekeyTransactionTx`) with the trade or sale row following it. A sell is a
 *   shared purchase whose id is in the relay's log, so the old id goes with the copy, as every purchase's does.
 *
 * Every figure — balances, holdings, units, rates, days — stays to the unit. Categories Personal has no copy of are
 * made there first, with capture on. When Personal is itself shared and active, what lands in it that never travelled
 * in the copy's share is captured afterwards as any write to it would be; what came through the copy stays local
 * (its partners hold it already). Returns the new ids, purchases first.
 */
export async function keepInPersonalTx(tx: Tx, ws: WorkspaceContext, bookId: string, keep: { purchases: readonly string[]; records: readonly string[] }): Promise<string[]> {
  const all = [...keep.purchases, ...keep.records];
  if (all.length === 0) return [];
  const personal = await personalBookIdTx(tx, ws.workspaceId);
  if (!personal || personal === bookId) throw new BookError('NOT_FOUND', 'Personal is not here to keep them in');
  const tables = await tablesOf(tx);
  const there = await personalCategoryOfTx(tx, ws, bookId, personal);
  // Phase 0, capture on: every category these need in Personal, made there now if it has none (captured like any new one).
  const named = await tx.values<[string]>(sql`
    SELECT account_id FROM entries WHERE transaction_id IN ${all}
    UNION SELECT spend_category_id FROM entries WHERE transaction_id IN ${all} AND spend_category_id IS NOT NULL`);
  for (const [categoryId] of named) await there(categoryId);

  // Which of them came through the copy's share (a lineage of the copy holds them): its partners hold them already.
  const throughShare = new Set(
    tables.has('sync_lineage')
      ? (
          await tx.values<[string]>(sql`
            SELECT head_transaction_id FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IN ${all}
            UNION SELECT lineage_id FROM sync_lineage WHERE book_id = ${bookId} AND lineage_id IN ${all}
            ${tables.has('sync_lineage_last') ? sql`UNION SELECT l.transaction_id FROM sync_lineage_last l JOIN sync_lineage s ON s.lineage_id = l.lineage_id WHERE s.book_id = ${bookId} AND l.transaction_id IN ${all}` : sql``}`)
        ).map(([id]) => id)
      : [],
  );

  // Phase 1, capture off: the copy is read-only (§8.6), and nothing written to it is sent.
  const landed = await withCaptureSuspended(tx, async () => {
    const out: string[] = [];
    for (const id of keep.purchases) {
      const input = await inputOfTx(tx, ws, id);
      const lines = [];
      for (const line of input.lines) {
        lines.push({ ...line, accountId: await there(line.accountId), ...(line.spendCategoryId ? { spendCategoryId: await there(line.spendCategoryId) } : {}) });
      }
      try {
        const next = await replaceTransactionTx(tx, inBook(ws, bookId), id, { ...input, lines, moveToBook: true, toBookId: personal });
        await tx.run(sql`UPDATE transactions SET replaces_transaction_id = NULL WHERE id = ${next}`);
        out.push(next);
      } catch (failure) {
        if (failure instanceof LedgerError) throw new BookError('CANNOT_MOVE', `${input.description || 'A purchase'} cannot move to Personal: ${failure.message} Nothing was deleted.`);
        throw failure;
      }
    }
    // Every local row that names a transaction follows its new id, but the copy's own lineages (erased with it).
    const local = (await referencesTo(tx, tables, 'transactions')).filter(([table]) => !COPY_SYNC_REFS.has(table));
    for (const id of keep.records) {
      await refileInPlaceTx(tx, ws, id, bookId, personal, there);
      out.push(await rekeyTransactionTx(tx, ws, id, local));
    }
    return out;
  });

  // Phase 2, capture on: Personal shared and active here takes, as any write to it, only what never travelled in the
  // copy's share (fix round 4, R3-I1, ruled option 2). A row that came through the copy is held by its partners in
  // their copies already, and the copy can never send them a void (it is read-only): sent to Personal's partner too, it
  // would be counted twice where the same partner is in both. Never doubling wins over a partner of Personal who is not
  // in the copy seeing it. Only purchases are sent here: every row kept is filed in Personal (a moved purchase, a
  // re-filed trade or sale). A bare own transfer is never filed in a shared copy (`fileTransferTx` writes only its
  // redacted row there), so it is never in the erase set and never lands here.
  const [shared] = tables.has('shared_books') ? await tx.values<[string]>(sql`SELECT state FROM shared_books WHERE book_id = ${personal}`) : [];
  if (shared?.[0] === 'active') {
    const sources = [...keep.purchases, ...keep.records];
    for (const [i, id] of landed.entries()) {
      if (throughShare.has(sources[i]!)) continue;
      if ((await tx.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${id} AND book_id = ${personal}`)).length > 0) {
        await capturePostedTx(tx, id, personal, null);
      }
    }
  }
  return landed;
}

/** The copy's sync rows that name a transaction: they go with the copy, and never follow a kept row's new id. */
const COPY_SYNC_REFS: ReadonlySet<string> = new Set(['sync_lineage', 'sync_lineage_last', 'shared_transfers']);

/**
 * The plan of the book (shared by void and erase): its caps with their month overrides, shares and units, its expected
 * income and bonus months. Returns how many caps went.
 */
export async function deleteBookPlanTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<number> {
  const categoryIds = (await tx.values<[string]>(sql`SELECT category_account_id FROM book_categories WHERE book_id = ${bookId}`)).map(([id]) => id);
  let caps = 0;
  if (categoryIds.length) {
    const capIds = (await tx.values<[string]>(sql`SELECT id FROM budgets WHERE workspace_id = ${ws.workspaceId} AND category_account_id IN ${categoryIds}`)).map(([id]) => id);
    caps = capIds.length;
    if (capIds.length) {
      await tx.run(sql`DELETE FROM budget_overrides WHERE budget_id IN ${capIds}`);
      await tx.run(sql`DELETE FROM budget_shares WHERE budget_id IN ${capIds}`);
      if (await healthTablesExist(tx)) await tx.run(sql`DELETE FROM budget_frequencies WHERE budget_id IN ${capIds}`);
      await tx.run(sql`DELETE FROM budgets WHERE id IN ${capIds}`);
    }
  }
  await tx.run(sql`DELETE FROM book_budget_settings WHERE book_id = ${bookId}`);
  await tx.run(sql`DELETE FROM book_income_overrides WHERE book_id = ${bookId}`);
  return caps;
}

/** The book's sync state and sharing bookkeeping (§5.2 item 2), every table that keys a row by it. */
const SYNC_TABLES = [
  'sync_outbox',
  'sync_cursor',
  'sync_field_clocks',
  'sync_kept_clocks',
  'sync_tombstones',
  'sync_skipped',
  'sync_authority',
  'sync_authority_devices',
  'sync_invites_used',
  'book_epoch_keys',
  'book_devices',
  'book_members',
  'shared_transfers',
  'shared_books',
];

/** Rows of an entry that go with it. */
const GOES_WITH_ENTRY: readonly [table: string, column: string][] = [
  ['fx_lot_uses', 'out_entry_id'],
  ['fx_lot_uses', 'lot_entry_id'],
  ['fx_shortfalls', 'entry_id'],
  ['fx_day_values', 'entry_id'],
];

/** Every column of every table that names a row of `target`: by foreign key, or (accounts) by a column called so. */
async function referencesTo(tx: Db, tables: Set<string>, target: 'accounts' | 'transactions'): Promise<[string, string][]> {
  const out = new Map<string, [string, string]>();
  const named = target === 'accounts' ? /(^|_)account_id$|(^|_)category_id$/ : /(^|_)transaction_id$/;
  for (const table of tables) {
    if (table.startsWith('sqlite_')) continue;
    for (const [to, from] of await tx.values<[string, string]>(sql`SELECT "table", "from" FROM pragma_foreign_key_list(${table})`)) {
      if (to === target) out.set(`${table}.${from}`, [table, from]);
    }
    for (const [column] of await tx.values<[string]>(sql`SELECT name FROM pragma_table_info(${table})`)) {
      if (named.test(column)) out.set(`${table}.${column}`, [table, column]);
    }
  }
  return [...out.values()];
}

const ERASE = sql.raw('temp.book_erase_ids');

/**
 * Erases the book and everything only it holds (spec §5.2), in the caller's transaction with capture off: nothing of
 * it is a change to send. Refusals are the caller's (`deleteBook` plans first); one a record still names
 * (`keptByRecordsTx`) throws `RECORDS` here too, before anything is voided. Posted transactions are voided first, so
 * whatever a void undoes elsewhere (a settlement, a deposit event) is undone as today, then every row is erased. A void
 * that refuses (a fund switch) throws `CANNOT_VOID` and the caller's transaction rolls back.
 */
export async function eraseBookTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<{ transactions: number; categories: number; budgets: number }> {
  return withCaptureSuspended(tx, async () => {
    const tables = await tablesOf(tx);
    const has = (table: string) => tables.has(table);
    const me = await memberHereTx(tx, bookId, tables);

    /* ---- 1. Goals that came only through the share (§5.2 item 5), while the share's bookkeeping still says whose. */
    if (has('goal_shares')) {
      const links = await tx.values<[string, string]>(sql`SELECT goal_id, shared_by FROM goal_shares WHERE book_id = ${bookId}`);
      for (const [goalId, sharedBy] of links) {
        if (sharedBy === me) continue;
        const here = (await tx.values(sql`SELECT 1 FROM goals WHERE id = ${goalId} AND workspace_id = ${ws.workspaceId}`)).length > 0;
        if (here && !(await hasOwnPartTx(tx, goalId))) await deleteGoalRowsTx(tx, ws, goalId);
      }
      // Every other link ends here as the share's end ends it (C15): this member's own goal stays theirs, a goal with
      // money of theirs in it becomes their private copy, and each link with its lines and clocks goes.
      await endSharedGoalsTx(tx, ws, bookId, me ?? undefined);
    }

    /* ---- 2. Which transactions (`eraseSetSql`). One a record still names refuses the whole delete, before any void. */
    const kept = await keptByRecordsTx(tx, ws, bookId, tables);
    const count = kept.own.length + kept.other.length;
    if (count > 0) {
      const [kind] = await tx.values<[BookKind]>(sql`SELECT kind FROM books WHERE id = ${bookId}`);
      throw new BookError('RECORDS', recordsMessage(count, await readOnlyCopyTx(tx, bookId, kind?.[0] ?? 'family')));
    }
    await tx.run(sql`CREATE TEMP TABLE IF NOT EXISTS book_erase_ids (id TEXT PRIMARY KEY)`);
    await tx.run(sql`DELETE FROM ${ERASE}`);
    await tx.run(sql`INSERT OR IGNORE INTO ${ERASE} (id) ${eraseSetSql(ws, bookId, tables)}`);

    /* ---- 3. The money: every posted one voided (newest first; a void can void others with it), as deleteBook does. */
    const posted = await tx.values<[string]>(sql`SELECT t.id FROM transactions t JOIN ${ERASE} x ON x.id = t.id WHERE t.status = 'posted' ORDER BY t.occurred_on DESC, t.created_at DESC`);
    for (const [id] of posted) {
      const [status] = await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${id}`);
      if (status?.[0] !== 'posted') continue;
      try {
        await voidTransactionTx(tx, ws, id);
      } catch (failure) {
        if (failure instanceof LedgerError) throw new BookError('CANNOT_VOID', `${failure.message} Nothing was deleted.`);
        throw failure;
      }
    }

    /* ---- 4. The transactions' rows, then the transactions. */
    const entryIds = sql`SELECT id FROM entries WHERE transaction_id IN (SELECT id FROM ${ERASE})`;
    for (const [table, column] of GOES_WITH_ENTRY) {
      if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(column)} IN (${entryIds})`);
    }
    for (const [table, column] of GOES_WITH_TRANSACTION) {
      if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(column)} IN (SELECT id FROM ${ERASE})`);
    }
    for (const [table, column, also] of CLEARED_WITH_TRANSACTION) {
      if (!has(table)) continue;
      const extra = also ? sql`, ${sql.raw(also)} = NULL` : sql``;
      await tx.run(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = NULL${extra} WHERE ${sql.raw(column)} IN (SELECT id FROM ${ERASE})`);
    }
    await tx.run(sql`DELETE FROM audit_log WHERE entity = 'transaction' AND entity_id IN (SELECT id FROM ${ERASE})`);
    await eraseVoidTransactionsTx(tx, ws, sql`SELECT id FROM ${ERASE}`);
    // A void row filed in another book too stays there; it loses its filing here.
    await tx.run(sql`DELETE FROM book_transactions WHERE book_id = ${bookId}`);
    if (has('book_transaction_splits')) await tx.run(sql`DELETE FROM book_transaction_splits WHERE book_id = ${bookId}`);

    /* ---- 5. The sync state and the share's bookkeeping. */
    if (has('sync_lineage')) {
      if (has('sync_lineage_last')) await tx.run(sql`DELETE FROM sync_lineage_last WHERE lineage_id IN (SELECT lineage_id FROM sync_lineage WHERE book_id = ${bookId})`);
      await tx.run(sql`DELETE FROM sync_lineage WHERE book_id = ${bookId}`);
    }
    for (const table of SYNC_TABLES) if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
    await tx.run(sql`DELETE FROM settings WHERE key IN (${`sharing.member.${bookId}`}, ${`sharing.seen.${bookId}`}, ${`sharing.arriving.${bookId}`})`);

    /* ---- 6. The plan, the bills on its categories, then the categories and the placeholders. */
    const budgets = await deleteBookPlanTx(tx, ws, bookId);
    const categoryIds = (await tx.values<[string]>(sql`SELECT category_account_id FROM book_categories WHERE book_id = ${bookId}`)).map(([id]) => id);
    const [[openCategories]] = categoryIds.length
      ? ((await tx.values<[number]>(sql`SELECT count(*) FROM accounts WHERE id IN ${categoryIds} AND archived_at IS NULL`)) as [[number]])
      : [[0]];
    if (categoryIds.length && has('expense_templates')) {
      const bills = (await tx.values<[string]>(sql`SELECT id FROM expense_templates WHERE category_account_id IN ${categoryIds}`)).map(([id]) => id);
      if (bills.length) {
        for (const table of ['bill_windows', 'bill_skips', 'bill_pauses', 'bill_payments']) {
          if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE template_id IN ${bills}`);
        }
        for (const table of ['sinking_fund_entries', 'sinking_funds']) {
          if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE bill_id IN ${bills}`);
        }
        await tx.run(sql`UPDATE transactions SET template_id = NULL WHERE template_id IN ${bills}`);
        await tx.run(sql`DELETE FROM expense_templates WHERE id IN ${bills}`);
      }
    }
    if (categoryIds.length) {
      for (const table of ['category_needs', 'category_colours']) {
        if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE category_account_id IN ${categoryIds}`);
      }
      if (has('category_mccs')) await tx.run(sql`DELETE FROM category_mccs WHERE category_id IN ${categoryIds}`);
    }
    // Category sets filed only here: their members, then the set, unless an event still names it (archived then).
    if (has('book_category_sets')) {
      const sets = (await tx.values<[string]>(sql`SELECT set_id FROM book_category_sets WHERE book_id = ${bookId}`)).map(([id]) => id);
      await tx.run(sql`DELETE FROM book_category_sets WHERE book_id = ${bookId}`);
      for (const setId of sets) {
        const named = has('events') && (await tx.values(sql`SELECT 1 FROM events WHERE set_id = ${setId} LIMIT 1`)).length > 0;
        if (named) {
          await tx.run(sql`UPDATE category_sets SET archived_at = ${new Date().toISOString()} WHERE id = ${setId} AND archived_at IS NULL`);
          continue;
        }
        await tx.run(sql`DELETE FROM category_set_members WHERE set_id = ${setId}`);
        await tx.run(sql`DELETE FROM category_sets WHERE id = ${setId}`);
      }
    }
    const placeholders = has('book_member_accounts')
      ? (await tx.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId}`)).map(([id]) => id)
      : [];
    await tx.run(sql`DELETE FROM book_categories WHERE book_id = ${bookId}`);
    await eraseAccountsTx(tx, tables, categoryIds, 'archive');
    // A placeholder a transfer between partners still names (the net-worth group log's, which this erase leaves as it
    // is) stays as it was, still hidden by its mapping row; every other one goes with its mapping row.
    const gone = await eraseAccountsTx(tx, tables, placeholders, 'keep', new Set(['book_member_accounts.account_id']));
    if (gone.length) await tx.run(sql`DELETE FROM book_member_accounts WHERE account_id IN ${gone}`);

    /* ---- 7. The workspace itself. If it was the open one, the app falls back to Personal. */
    const key = `active_book:${ws.workspaceId}`;
    const [remembered] = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${key}`);
    if (remembered?.[0] === bookId) {
      const personal = await personalBookIdTx(tx, ws.workspaceId);
      if (personal && personal !== bookId) await tx.run(sql`UPDATE settings SET value = ${personal} WHERE key = ${key}`);
      else await tx.run(sql`DELETE FROM settings WHERE key = ${key}`);
    }
    await tx.run(sql`DELETE FROM books WHERE id = ${bookId} AND workspace_id = ${ws.workspaceId}`);
    await tx.run(sql`DELETE FROM ${ERASE}`);
    return { transactions: posted.length, categories: Number(openCategories), budgets };
  });
}

/**
 * The book's categories or placeholders, each erased when nothing left names it, children before parents. One still
 * named (another book's event earning by a category, a partner transfer on a placeholder) is archived (`'archive'`)
 * or left exactly as it is (`'keep'`), and keeps its id. `ignore` names columns not to count (a placeholder's own
 * mapping row). Returns the ids erased.
 */
async function eraseAccountsTx(tx: Db, tables: Set<string>, ids: readonly string[], named: 'archive' | 'keep', ignore: ReadonlySet<string> = new Set()): Promise<string[]> {
  if (ids.length === 0) return [];
  const erased: string[] = [];
  await tx.run(sql`CREATE TEMP TABLE IF NOT EXISTS book_erase_accounts (id TEXT PRIMARY KEY)`);
  await tx.run(sql`DELETE FROM temp.book_erase_accounts`);
  for (const id of ids) await tx.run(sql`INSERT OR IGNORE INTO temp.book_erase_accounts (id) VALUES (${id})`);
  const refs = (await referencesTo(tx, tables, 'accounts')).filter(([table, column]) => !ignore.has(`${table}.${column}`));
  for (;;) {
    const inUse = new Set<string>();
    for (const [table, column] of refs) {
      const rows = await tx.values<[string]>(sql`SELECT DISTINCT ${sql.raw(column)} FROM ${sql.raw(table)} WHERE ${sql.raw(column)} IN (SELECT id FROM temp.book_erase_accounts)`);
      for (const [id] of rows) inUse.add(id);
    }
    const left = (await tx.values<[string]>(sql`SELECT id FROM temp.book_erase_accounts`)).map(([id]) => id);
    const free = left.filter((id) => !inUse.has(id));
    if (free.length === 0) break;
    await tx.run(sql`DELETE FROM accounts WHERE id IN ${free}`);
    await tx.run(sql`DELETE FROM temp.book_erase_accounts WHERE id IN ${free}`);
    erased.push(...free);
  }
  if (named === 'archive') {
    await tx.run(sql`UPDATE accounts SET archived_at = ${new Date().toISOString()} WHERE archived_at IS NULL AND id IN (SELECT id FROM temp.book_erase_accounts)`);
  }
  await tx.run(sql`DELETE FROM temp.book_erase_accounts`);
  return erased;
}
