import { type SQL, sql } from 'drizzle-orm';
import { inBook, type WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { withCaptureSuspended } from '../sync/capture';
import { endSharedGoalsTx, hasOwnPartTx } from '../sync/goals/follow';
import { createAccountTx } from './accounts';
import { inputOfTx } from './activity';
import { BookError, personalBookIdTx, type BookKind } from './books';
import { healthTablesExist } from './health-tables';
import { eraseVoidTransactionsTx, LedgerError, replaceTransactionTx, voidTransactionTx } from './ledger';
import { categoryInBookTx } from './move-group';
import { deleteGoalRowsTx } from './goals';

/*
 * Deleting a workspace that is or was shared ERASES what belongs only to it (sharing resilience spec §5), where a
 * never-shared one is voided (`book-delete.ts`). Its ids live on in the partners' copies and on the relay's log: voided
 * rows and archived categories left here would stand in the way of the same workspace being shared to this phone again.
 *
 * "Only it": decided by book scoping, never by names. A transaction is the book's when it is filed in it (its row, a
 * split's part, an entry on one of its categories) or is one of its purchases (`sync_lineage`), with every version of
 * it (the `replaces_transaction_id` chain, both ways) — unless it is filed in another book too: that one stays. A
 * category is the book's when `book_categories` puts it there; a placeholder when `book_member_accounts` does; a goal
 * when this book's `goal_shares` shared it in. An account still named by anything left (another book's event, a row
 * kept) loses only its tag and is archived; every other account (bank, card, wallet, joint) is never touched, and its
 * balance changes only by the erased transactions, exactly as voiding them changes it.
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

/**
 * The purchases in a joined copy paid from this member's own accounts (owner decision, plan Task A5): posted, filed in
 * the book, with a money side and every money line on an account of this phone's own — not a placeholder (another
 * member's money), not a joint account, not paid from a partner's shared item — and recorded by this member. Oldest first.
 */
export async function ownPurchasesTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<string[]> {
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
    SELECT t.id FROM transactions t WHERE t.workspace_id = ${ws.workspaceId} AND t.id IN (${filedSql(bookId, tables)})
      AND EXISTS (SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = t.id AND a.kind IN ('asset', 'liability'))
      ${notReceived} ${byMe} ${derived}
    ORDER BY t.occurred_on, t.created_at, t.id`);
  return rows.map(([id]) => id);
}

/**
 * Moves this member's own purchases out of the copy into Personal before the copy is erased (owner decision), by the
 * move Move to workspace makes (`replaceTransactionTx` with `moveToBook`): each category swapped for its copy in
 * Personal, made there when Personal has none. What lands in Personal is an ordinary local purchase: it replaces
 * nothing (the copy's row it replaced is erased) and has no lineage. Returns the new transaction ids.
 */
export async function keepOwnInPersonalTx(tx: Tx, ws: WorkspaceContext, bookId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const personal = await personalBookIdTx(tx, ws.workspaceId);
  if (!personal || personal === bookId) throw new BookError('NOT_FOUND', 'Personal is not here to keep the purchases in');
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
  const moved: string[] = [];
  for (const id of ids) {
    const input = await inputOfTx(tx, ws, id);
    const lines = [];
    for (const line of input.lines) {
      lines.push({ ...line, accountId: await there(line.accountId), ...(line.spendCategoryId ? { spendCategoryId: await there(line.spendCategoryId) } : {}) });
    }
    try {
      const next = await replaceTransactionTx(tx, inBook(ws, bookId), id, { ...input, lines, moveToBook: true, toBookId: personal });
      await tx.run(sql`UPDATE transactions SET replaces_transaction_id = NULL WHERE id = ${next}`);
      moved.push(next);
    } catch (failure) {
      if (failure instanceof LedgerError) throw new BookError('CANNOT_MOVE', `${input.description || 'A purchase'} cannot move to Personal: ${failure.message} Nothing was deleted.`);
      throw failure;
    }
  }
  return moved;
}

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
 * it is a change to send. Refusals are the caller's (`deleteBook` plans first). Posted transactions are voided first,
 * so whatever a void undoes elsewhere (a settlement, a deposit event) is undone as today, then every row is erased.
 * A void that refuses (a sale, a fund switch) throws `CANNOT_VOID` and the caller's transaction rolls back.
 */
export async function eraseBookTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<{ transactions: number; categories: number; budgets: number }> {
  return withCaptureSuspended(tx, async () => {
    const tables = await tablesOf(tx);
    const has = (table: string) => tables.has(table);
    const me = await memberHereTx(tx, bookId, tables);

    /* ---- 1. Which transactions: filed or of a lineage of the book, with every version, none filed elsewhere. */
    await tx.run(sql`CREATE TEMP TABLE IF NOT EXISTS book_erase_ids (id TEXT PRIMARY KEY)`);
    await tx.run(sql`DELETE FROM ${ERASE}`);
    const elsewhere = sql`(EXISTS (SELECT 1 FROM book_transactions b WHERE b.transaction_id = t.id AND b.book_id <> ${bookId})
      ${has('book_transaction_splits') ? sql`OR EXISTS (SELECT 1 FROM book_transaction_splits s WHERE s.transaction_id = t.id AND s.book_id <> ${bookId})` : sql``}
      OR EXISTS (SELECT 1 FROM entries e JOIN book_categories c ON c.category_account_id = e.account_id WHERE e.transaction_id = t.id AND c.book_id <> ${bookId}))`;
    const seeds: SQL[] = [sql`t.id IN (${filedSql(bookId, tables, sql`1 = 1`)})`];
    if (has('book_member_accounts')) {
      seeds.push(sql`t.id IN (SELECT e.transaction_id FROM entries e WHERE e.account_id IN (SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId}))`);
    }
    if (has('sync_lineage')) {
      seeds.push(sql`t.id IN (SELECT head_transaction_id FROM sync_lineage WHERE book_id = ${bookId})`);
      seeds.push(sql`t.id IN (SELECT lineage_id FROM sync_lineage WHERE book_id = ${bookId})`);
      if (has('sync_lineage_last')) {
        seeds.push(sql`t.id IN (SELECT l.transaction_id FROM sync_lineage_last l JOIN sync_lineage s ON s.lineage_id = l.lineage_id WHERE s.book_id = ${bookId})`);
      }
    }
    await tx.run(sql`INSERT OR IGNORE INTO ${ERASE} (id) SELECT t.id FROM transactions t
      WHERE t.workspace_id = ${ws.workspaceId} AND (${sql.join(seeds, sql` OR `)}) AND NOT ${elsewhere}`);
    // The other versions of each: only void ones join this way, so a live row elsewhere reached through a chain (a
    // purchase edited into a transfer, say) is never taken; its link to an erased version is cleared below.
    for (;;) {
      const [[before]] = (await tx.values<[number]>(sql`SELECT count(*) FROM ${ERASE}`)) as [[number]];
      await tx.run(sql`INSERT OR IGNORE INTO ${ERASE} (id) SELECT t.id FROM transactions t
        WHERE t.workspace_id = ${ws.workspaceId} AND t.status <> 'posted' AND t.id NOT IN (SELECT id FROM ${ERASE})
          AND (t.replaces_transaction_id IN (SELECT id FROM ${ERASE})
            OR t.id IN (SELECT r.replaces_transaction_id FROM transactions r WHERE r.id IN (SELECT id FROM ${ERASE})))
          AND NOT ${elsewhere}`);
      const [[after]] = (await tx.values<[number]>(sql`SELECT count(*) FROM ${ERASE}`)) as [[number]];
      if (Number(after) === Number(before)) break;
    }
    // A transaction something else keeps a record of, which this erase does not know how to take (a trade, a sale),
    // stays: voided below, as today.
    const handled = new Set([...GOES_WITH_TRANSACTION, ...CLEARED_WITH_TRANSACTION].map(([t, c]) => `${t}.${c}`).concat(['entries.transaction_id', 'sync_lineage.head_transaction_id']));
    const keptBy: [string, string][] = (await referencesTo(tx, tables, 'transactions')).filter(([t, c]) => !handled.has(`${t}.${c}`));
    const kept = new Set<string>();
    for (const [table, column] of keptBy) {
      const rows = await tx.values<[string]>(sql`SELECT DISTINCT ${sql.raw(column)} FROM ${sql.raw(table)} WHERE ${sql.raw(column)} IN (SELECT id FROM ${ERASE})`);
      for (const [id] of rows) kept.add(id);
    }

    /* ---- 2. The money: every posted one voided (newest first; a void can void others with it), as deleteBook does. */
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
    for (const id of kept) await tx.run(sql`DELETE FROM ${ERASE} WHERE id = ${id}`);

    /* ---- 3. Goals that came only through the share (§5.2 item 5), while the share's bookkeeping still says whose. */
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
    // A row kept (filed elsewhere, or kept by a record) loses its filing here; its own rows stay.
    await tx.run(sql`DELETE FROM book_transactions WHERE book_id = ${bookId}`);
    if (has('book_transaction_splits')) await tx.run(sql`DELETE FROM book_transaction_splits WHERE book_id = ${bookId}`);

    /* ---- 5. The sync state and the share's bookkeeping. */
    if (has('sync_lineage')) {
      if (has('sync_lineage_last')) await tx.run(sql`DELETE FROM sync_lineage_last WHERE lineage_id IN (SELECT lineage_id FROM sync_lineage WHERE book_id = ${bookId})`);
      await tx.run(sql`DELETE FROM sync_lineage WHERE book_id = ${bookId}`);
    }
    for (const table of SYNC_TABLES) if (has(table)) await tx.run(sql`DELETE FROM ${sql.raw(table)} WHERE book_id = ${bookId}`);
    await tx.run(sql`DELETE FROM settings WHERE key IN (${`sharing.member.${bookId}`}, ${`sharing.seen.${bookId}`})`);

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
        const named = (await tx.values(sql`SELECT 1 FROM events WHERE set_id = ${setId} LIMIT 1`)).length > 0;
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
    if (has('book_member_accounts')) await tx.run(sql`DELETE FROM book_member_accounts WHERE book_id = ${bookId}`);
    await eraseAccountsTx(tx, tables, [...categoryIds, ...placeholders]);

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
    return { transactions: posted.filter(([id]) => !kept.has(id)).length, categories: Number(openCategories), budgets };
  });
}

/**
 * The book's categories and placeholders, each erased when nothing left names it, children before parents; one still
 * named (another book's event earning by it, a row kept) is archived instead and keeps its id.
 */
async function eraseAccountsTx(tx: Db, tables: Set<string>, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.run(sql`CREATE TEMP TABLE IF NOT EXISTS book_erase_accounts (id TEXT PRIMARY KEY)`);
  await tx.run(sql`DELETE FROM temp.book_erase_accounts`);
  for (const id of ids) await tx.run(sql`INSERT OR IGNORE INTO temp.book_erase_accounts (id) VALUES (${id})`);
  const refs = await referencesTo(tx, tables, 'accounts');
  for (;;) {
    const named = new Set<string>();
    for (const [table, column] of refs) {
      const rows = await tx.values<[string]>(sql`SELECT DISTINCT ${sql.raw(column)} FROM ${sql.raw(table)} WHERE ${sql.raw(column)} IN (SELECT id FROM temp.book_erase_accounts)`);
      for (const [id] of rows) named.add(id);
    }
    const left = (await tx.values<[string]>(sql`SELECT id FROM temp.book_erase_accounts`)).map(([id]) => id);
    const free = left.filter((id) => !named.has(id));
    if (free.length === 0) break;
    await tx.run(sql`DELETE FROM accounts WHERE id IN ${free}`);
    await tx.run(sql`DELETE FROM temp.book_erase_accounts WHERE id IN ${free}`);
  }
  await tx.run(sql`UPDATE accounts SET archived_at = ${new Date().toISOString()} WHERE archived_at IS NULL AND id IN (SELECT id FROM temp.book_erase_accounts)`);
  await tx.run(sql`DELETE FROM temp.book_erase_accounts`);
}
