import { currencyInfo, type PostingLine, uuidv7 } from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { postTransactionTx, replaceTransactionTx, voidTransactionTx, type PostTransactionInput } from '../repos/ledger';
import { isRevivable, projectPurchase, ROW_CLOCK, withCapturePaused, type PurchaseFields, type PurchaseMoney } from './capture';
import { decodeHlc, driftBlocks, receiveHlc } from './hlc';
import { openSealedKey } from './crypto';
import { deviceIdOf } from './relay-signing';
import { MissingEpochKeyError, verifyEntry, type ChangeLogEntry, type Sealer } from './seal';
import { entityOf, NEVER_SYNCED_COLUMNS, parseOpId, type RowEntity } from './shared-entities';
import type { ChangeSet, Op, SequencedEntry, SyncTransport } from './types';
import { uuidv5 } from './uuidv5';

/*
 * Apply and merge (household-sharing spec §7). The pull loop reads the relay's log from this device's cursor, and
 * applies each change-set in one db transaction with the cursor's advance, capture switched off (§7.2): what it writes
 * was emitted by the device that made the change, so it never re-emits.
 *
 * The merge (§7.3): per field, the later hlc wins (`sync_field_clocks`); money is one atom (`purchase.money`); void
 * wins; a tombstone ends an entity keyed by its own id for ever, while one keyed by anything else (`isRevivable`)
 * comes back when it is made again with a later hlc (controller ruling); structure never destroys money
 * (Uncategorised); a change-set applied again wins no field.
 */

/** Everything apply needs to know about the book on this device. */
export interface BookContext {
  bookId: string;
  /** The local workspace, whose id apply stamps on every row it inserts (§4.1). */
  ws: WorkspaceContext;
  /** This device's member in the book. */
  memberId: string;
  /** The book's currency, which is every member's workspace currency (ruled O3). */
  currency: string;
}

export async function bookContextTx(tx: Db, bookId: string): Promise<BookContext> {
  const [row] = await tx.values<[string, string, string, string]>(sql`
    SELECT b.workspace_id, w.base_currency, b.base_currency, s.member_id
    FROM books b JOIN workspaces w ON w.id = b.workspace_id JOIN shared_books s ON s.book_id = b.id
    WHERE b.id = ${bookId}`);
  if (!row) throw new Error(`Book ${bookId} is not shared on this device`);
  const [workspaceId, baseCurrency, currency, memberId] = row;
  return { bookId, ws: { workspaceId, baseCurrency }, memberId, currency };
}

/* ------------------------------------------------------------------ clocks */

async function clockOf(tx: Db, ctx: BookContext, entity: string, id: string, field: string): Promise<string | null> {
  const rows = await tx.values<[string]>(
    sql`SELECT hlc FROM sync_field_clocks WHERE book_id = ${ctx.bookId} AND entity = ${entity} AND id = ${id} AND field = ${field}`,
  );
  return rows[0]?.[0] ?? null;
}

async function setClock(tx: Db, ctx: BookContext, entity: string, id: string, field: string, hlc: string): Promise<void> {
  await tx.run(
    sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES (${ctx.bookId}, ${entity}, ${id}, ${field}, ${hlc}) ON CONFLICT (book_id, entity, id, field) DO UPDATE SET hlc = excluded.hlc`,
  );
}

async function tombstoneOf(tx: Db, ctx: BookContext, entity: string, id: string): Promise<string | null> {
  const rows = await tx.values<[string]>(sql`SELECT hlc FROM sync_tombstones WHERE book_id = ${ctx.bookId} AND entity = ${entity} AND id = ${id}`);
  return rows[0]?.[0] ?? null;
}

async function setTombstone(tx: Db, ctx: BookContext, entity: string, id: string, hlc: string, last: Record<string, unknown> | null = null): Promise<void> {
  await tx.run(
    sql`INSERT INTO sync_tombstones (book_id, entity, id, hlc, last_json) VALUES (${ctx.bookId}, ${entity}, ${id}, ${hlc}, ${last ? JSON.stringify(last) : null}) ON CONFLICT (book_id, entity, id) DO UPDATE SET hlc = max(hlc, excluded.hlc), last_json = coalesce(excluded.last_json, last_json)`,
  );
}

/** The values a revivable row had when it was deleted here, kept beside its tombstone (§7.2). */
async function retainedOf(tx: Db, ctx: BookContext, entity: string, id: string): Promise<Record<string, unknown>> {
  const rows = await tx.values<[string | null]>(sql`SELECT last_json FROM sync_tombstones WHERE book_id = ${ctx.bookId} AND entity = ${entity} AND id = ${id}`);
  return rows[0]?.[0] ? (JSON.parse(rows[0][0]) as Record<string, unknown>) : {};
}

/** A row's synced field values, by field name (a revivable entity's fields are all plain columns). */
async function rowValuesOf(tx: Db, entity: RowEntity, where: SQL): Promise<Record<string, unknown>> {
  const fields = Object.entries(entity.fields);
  if (fields.length === 0) return {};
  const [row] = await tx.values<unknown[]>(sql`SELECT ${sql.raw(fields.map(([, c]) => c).join(', '))} FROM ${sql.raw(entity.table)} WHERE ${where}`);
  return row ? Object.fromEntries(fields.map(([f], i) => [f, row[i]])) : {};
}

/**
 * The fields of an upsert that beat their clocks (rule 1): no clock yet, or an older one. Only the fields the op
 * names as changed compete; a revivable row's other fields ride along for an insert only.
 */
async function winnersOf(tx: Db, ctx: BookContext, op: Extract<Op, { op: 'upsert' }>, hlc: string): Promise<Record<string, unknown>> {
  const winners: Record<string, unknown> = {};
  const named = op.changed ?? Object.keys(op.fields);
  for (const field of named) {
    if (!(field in op.fields)) continue;
    const value = op.fields[field];
    const clock = await clockOf(tx, ctx, op.entity, op.id, field);
    if (clock === null || hlc > clock) winners[field] = value;
  }
  return winners;
}

/**
 * A row op's winning fields, each with the hlc it wins at (rule 1). A revivable row's op carries every field, each at
 * its own hlc: the named (`changed`) ones at the change-set's, the rest at the clock the sender's `clocks` gives them
 * (state-based per-field last-writer-wins, task 4 fix round 2). A field whose clock the sender did not know competes
 * only against no clock at all.
 */
async function rowWinnersOf(tx: Db, ctx: BookContext, op: Extract<Op, { op: 'upsert' }>, hlc: string): Promise<Map<string, { value: unknown; hlc: string }>> {
  const winners = new Map<string, { value: unknown; hlc: string }>();
  const changed = op.changed ?? Object.keys(op.fields);
  for (const [field, value] of Object.entries(op.fields)) {
    const at = changed.includes(field) ? hlc : op.clocks?.[field];
    const clock = await clockOf(tx, ctx, op.entity, op.id, field);
    if (at === undefined) {
      if (clock === null && !op.changed) winners.set(field, { value, hlc });
      continue;
    }
    if (clock === null || at > clock) winners.set(field, { value, hlc: at });
  }
  return winners;
}

/* ------------------------------------------------------------ placeholders */

/**
 * The hidden account a member's money side is posted against on this device (spec §4.4): one per member, per book and
 * per currency (ruled O2), made on first need, named after the member. A device's own member gets one too, on a
 * device that did not pay (a second device of the same person, or a purchase whose payer device kept no own account).
 */
export async function placeholderAccountTx(tx: Db, ctx: BookContext, memberId: string, currency: string): Promise<string> {
  const [found] = await tx.values<[string]>(
    sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${ctx.bookId} AND member_id = ${memberId} AND currency = ${currency}`,
  );
  if (found) return found[0];
  const [member] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${ctx.bookId} AND member_id = ${memberId}`);
  const id = uuidv7();
  await tx.run(sql`
    INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
    VALUES (${id}, ${ctx.ws.workspaceId}, NULL, 'asset', 'cash', ${member?.[0] || 'Household member'}, NULL, ${currency}, NULL, 0, NULL, ${new Date().toISOString()})`);
  await tx.run(sql`INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (${id}, ${ctx.bookId}, ${memberId}, ${currency})`);
  return id;
}

async function isPlaceholder(tx: Db, accountId: string): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM book_member_accounts WHERE account_id = ${accountId}`)).length > 0;
}

/** The book's Uncategorised expense category (rule 4): the same id on every device, made on demand. */
export async function uncategorisedTx(tx: Db, ctx: BookContext): Promise<string> {
  const id = await uuidv5(ctx.bookId, 'uncategorised');
  const [found] = await tx.values(sql`SELECT 1 FROM accounts WHERE id = ${id}`);
  if (!found) {
    await tx.run(sql`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
      VALUES (${id}, ${ctx.ws.workspaceId}, NULL, 'expense', 'category', 'Uncategorised', NULL, NULL, NULL, 999, NULL, ${new Date().toISOString()})`);
    await tx.run(sql`INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${id}, ${ctx.ws.workspaceId}, ${ctx.bookId})`);
  }
  return id;
}

/* -------------------------------------------------------------- row entities */

/** Rows whose uniqueness is wider than their id: two devices can make one each, offline (two budgets on one category). */
const UNIQUE_SIBLINGS: Record<string, readonly string[]> = {
  budget: ['categoryAccountId'],
  budget_override: ['budgetId', 'month'],
};

/** What a row cannot be inserted without: the table and column its parent lives in, and the field or key naming it. */
const PARENTS: Record<string, { table: string; from: 'field' | 'key'; name: string }> = {
  category_need: { table: 'accounts', from: 'key', name: 'category_account_id' },
  budget: { table: 'accounts', from: 'field', name: 'categoryAccountId' },
  budget_override: { table: 'budgets', from: 'field', name: 'budgetId' },
  budget_frequency: { table: 'budgets', from: 'key', name: 'budget_id' },
  bill: { table: 'accounts', from: 'field', name: 'categoryAccountId' },
  bill_window: { table: 'expense_templates', from: 'key', name: 'template_id' },
  bill_skip: { table: 'expense_templates', from: 'key', name: 'template_id' },
};

function keyWhere(entity: RowEntity, key: Record<string, string>, ctx: BookContext): SQL {
  const parts = entity.keyColumns.map((column) => sql`${sql.raw(column)} = ${key[column]}`);
  if (entity.localOnInsert.includes('book_id') && !entity.keyColumns.includes('book_id')) parts.push(sql`book_id = ${ctx.bookId}`);
  if (entity.table === 'bill_skips') parts.push(sql`workspace_id = ${ctx.ws.workspaceId}`);
  return sql.join(parts, sql` AND `);
}

async function rowExists(tx: Db, entity: RowEntity, where: SQL): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM ${sql.raw(entity.table)} WHERE ${where}`)).length > 0;
}

/** Deletes a row and what only made sense against it (a budget's frequency and overrides). */
async function deleteRow(tx: Db, entity: RowEntity, where: SQL, key: Record<string, string>): Promise<void> {
  if (entity.entity === 'budget') {
    await tx.run(sql`DELETE FROM budget_frequencies WHERE budget_id = ${key.id}`);
    await tx.run(sql`DELETE FROM budget_overrides WHERE budget_id = ${key.id}`);
  }
  await tx.run(sql`DELETE FROM ${sql.raw(entity.table)} WHERE ${where}`);
}

/** A bill's `payer` as a local account (spec §4.4, corrected): an own account only while it already is one. */
async function payerAccountTx(tx: Db, ctx: BookContext, where: SQL, exists: boolean, payer: { memberId: string }): Promise<string> {
  if (payer.memberId === ctx.memberId && exists) {
    const [row] = await tx.values<[string]>(sql`SELECT money_account_id FROM expense_templates WHERE ${where}`);
    if (row && !(await isPlaceholder(tx, row[0]))) return row[0];
  }
  return placeholderAccountTx(tx, ctx, payer.memberId, ctx.currency);
}

/** The column values an op's fields write, the derived `payer` resolved to a local account. */
async function columnValues(tx: Db, ctx: BookContext, entity: RowEntity, fields: Record<string, unknown>, where: SQL, exists: boolean): Promise<[string, unknown][]> {
  const out: [string, unknown][] = [];
  for (const [field, value] of Object.entries(fields)) {
    const column = entity.fields[field];
    if (column) out.push([column, value]);
    else if (entity.entity === 'bill' && field === 'payer') out.push(['money_account_id', await payerAccountTx(tx, ctx, where, exists, value as { memberId: string })]);
  }
  return out;
}

async function insertRow(tx: Db, ctx: BookContext, entity: RowEntity, key: Record<string, string>, fields: Record<string, unknown>, where: SQL): Promise<void> {
  const values = new Map<string, unknown>(Object.entries(key));
  for (const [column, value] of await columnValues(tx, ctx, entity, fields, where, false)) values.set(column, value);
  // Apply stamps the local workspace id on every row it inserts (§4.1); member and device rows have none.
  if (NEVER_SYNCED_COLUMNS[entity.table]?.includes('workspace_id')) values.set('workspace_id', ctx.ws.workspaceId);
  const now = new Date().toISOString();
  for (const column of entity.localOnInsert) {
    if (values.has(column)) continue;
    values.set(column, column === 'kind' ? 'shared' : column === 'book_id' ? ctx.bookId : now);
  }
  const columns = [...values.keys()];
  await tx.run(
    sql`INSERT INTO ${sql.raw(entity.table)} (${sql.raw(columns.join(', '))}) VALUES (${sql.join(
      columns.map((c) => sql`${values.get(c) as string | number | null}`),
      sql`, `,
    )})`,
  );
  // A category is in the book by its tag row (§4.1): apply writes it; the ledger tags a purchase itself.
  if (entity.entity === 'category') {
    await tx.run(sql`INSERT OR IGNORE INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${key.id}, ${ctx.ws.workspaceId}, ${ctx.bookId})`);
  }
}

/** The entity a parent table's rows are, for reading its tombstone. */
const PARENT_ENTITY: Record<string, string> = { accounts: 'category', budgets: 'budget', expense_templates: 'bill' };

/**
 * Whether a row's parent is absent here: `'ended'` when the parent's own tombstone says it is gone for good (a deleted
 * budget, or one that lost to a sibling) — every device drops the child alike, as rule 3 drops ops for an ended row —
 * and `'unknown'` when nothing here explains it, which is recorded as a skip.
 */
async function parentMissing(tx: Db, ctx: BookContext, entity: RowEntity, key: Record<string, string>, fields: Record<string, unknown>): Promise<'ended' | 'unknown' | null> {
  const parent = PARENTS[entity.entity];
  const id = parent ? (parent.from === 'key' ? key[parent.name] : fields[parent.name]) : entity.entity === 'category' ? fields.parentId : null;
  if (id === null || id === undefined) return null;
  const table = parent?.table ?? 'accounts';
  if ((await tx.values(sql`SELECT 1 FROM ${sql.raw(table)} WHERE id = ${id as string}`)).length > 0) return null;
  return (await tombstoneOf(tx, ctx, PARENT_ENTITY[table]!, id as string)) !== null ? 'ended' : 'unknown';
}

/**
 * A row two devices made under different ids where the schema allows one (a budget per category, an override per
 * budget and month): the lower id wins on every device, and the other is tombstoned here, so neither comes back.
 * Returns whether the incoming row lost.
 */
async function settleSiblings(tx: Db, ctx: BookContext, entity: RowEntity, op: Extract<Op, { op: 'upsert' }>, hlc: string): Promise<boolean> {
  const unique = UNIQUE_SIBLINGS[entity.entity];
  if (!unique) return false;
  const match = sql.join(
    unique.map((field) => sql`${sql.raw(entity.fields[field]!)} = ${op.fields[field] as string}`),
    sql` AND `,
  );
  const [sibling] = await tx.values<[string]>(sql`SELECT id FROM ${sql.raw(entity.table)} WHERE ${match} AND workspace_id = ${ctx.ws.workspaceId} AND id <> ${op.id}`);
  if (!sibling) return false;
  if (sibling[0] < op.id) {
    await setTombstone(tx, ctx, entity.entity, op.id, hlc);
    return true;
  }
  await deleteRow(tx, entity, sql`id = ${sibling[0]}`, { id: sibling[0] });
  await setTombstone(tx, ctx, entity.entity, sibling[0], hlc);
  return false;
}

async function applyRowOp(tx: Db, ctx: BookContext, entity: RowEntity, op: Op, hlc: string): Promise<void> {
  const key = parseOpId(entity, op.id);
  const where = keyWhere(entity, key, ctx);
  const revivable = isRevivable(entity);
  const tomb = await tombstoneOf(tx, ctx, entity.entity, op.id);
  const exists = await rowExists(tx, entity, where);

  if (op.op === 'delete') {
    if (!revivable) {
      // Rule 3: an entity keyed by its own id never comes back; the first delete ends it.
      await setTombstone(tx, ctx, entity.entity, op.id, hlc);
      if (exists) await deleteRow(tx, entity, where, key);
      return;
    }
    if (tomb !== null && tomb >= hlc) return;
    const alive = await clockOf(tx, ctx, entity.entity, op.id, ROW_CLOCK);
    if (alive !== null && alive > hlc) return; // made again after this delete: the delete lost
    // Its last values and field clocks stay, so a later revive merges with them field by field.
    await setTombstone(tx, ctx, entity.entity, op.id, hlc, exists ? await rowValuesOf(tx, entity, where) : null);
    if (exists) await deleteRow(tx, entity, where, key);
    return;
  }

  const winners = await rowWinnersOf(tx, ctx, op, hlc);
  const record = async () => {
    for (const [field, { hlc: at }] of winners) await setClock(tx, ctx, entity.entity, op.id, field, at);
  };
  if (tomb !== null) {
    if (!revivable) return;
    if (hlc <= tomb) {
      // Still dead here, but its fields merge into what the tombstone kept, so a later revive reads them.
      if (winners.size === 0) return;
      const retained = await retainedOf(tx, ctx, entity.entity, op.id);
      for (const [field, { value }] of winners) retained[field] = value;
      await tx.run(sql`UPDATE sync_tombstones SET last_json = ${JSON.stringify(retained)} WHERE book_id = ${ctx.bookId} AND entity = ${entity.entity} AND id = ${op.id}`);
      await record();
      return;
    }
  }
  if (revivable) {
    const alive = await clockOf(tx, ctx, entity.entity, op.id, ROW_CLOCK);
    if (alive === null || hlc > alive) await setClock(tx, ctx, entity.entity, op.id, ROW_CLOCK, hlc);
  }
  if (exists) {
    if (winners.size === 0) return;
    const sets = await columnValues(tx, ctx, entity, Object.fromEntries([...winners].map(([f, { value }]) => [f, value])), where, true);
    if (sets.length) {
      await tx.run(
        sql`UPDATE ${sql.raw(entity.table)} SET ${sql.join(
          sets.map(([column, value]) => sql`${sql.raw(column)} = ${value as string | number | null}`),
          sql`, `,
        )} WHERE ${where}`,
      );
    }
    await record();
    return;
  }
  const orphan = await parentMissing(tx, ctx, entity, key, op.fields);
  if (orphan === 'ended') return;
  if (orphan === 'unknown') throw new SkipOp('its parent is gone here');
  if (await settleSiblings(tx, ctx, entity, op, hlc)) return;
  // Made again (a revive), or new here: each field is the winner's value, else what the tombstone kept, else the op's.
  const retained = tomb !== null ? await retainedOf(tx, ctx, entity.entity, op.id) : {};
  const values: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(op.fields)) {
    values[field] = winners.has(field) ? winners.get(field)!.value : field in retained ? retained[field] : value;
  }
  if (tomb !== null) await tx.run(sql`DELETE FROM sync_tombstones WHERE book_id = ${ctx.bookId} AND entity = ${entity.entity} AND id = ${op.id}`);
  await insertRow(tx, ctx, entity, key, values, where);
  await record();
}

/* ------------------------------------------------------------------ purchases */

interface LineageRow {
  head: string | null;
  paidBy: string;
  paidLabel: string;
}

async function lineageOf(tx: Db, lineageId: string): Promise<LineageRow | null> {
  const rows = await tx.values<[string | null, string, string]>(sql`SELECT head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${lineageId}`);
  const row = rows[0];
  return row ? { head: row[0], paidBy: row[1], paidLabel: row[2] } : null;
}

/** A line's category on this device, or the book's Uncategorised when it is unknown or gone (rule 4). */
async function localCategory(tx: Db, ctx: BookContext, categoryId: string): Promise<string> {
  const [row] = await tx.values<[string]>(sql`SELECT kind FROM accounts WHERE id = ${categoryId} AND workspace_id = ${ctx.ws.workspaceId}`);
  const gone = await tombstoneOf(tx, ctx, 'category', categoryId);
  if (row && (row[0] === 'income' || row[0] === 'expense') && gone === null) return categoryId;
  return uncategorisedTx(tx, ctx);
}

/** units of the base currency per one major unit of `currency`, from a line's carried pair (spec §4.3, corrected). */
function rateFromPair(currency: string, base: string, amountMinor: number, amountBaseMinor: number): number | null {
  if (amountMinor === 0) return null;
  const rate = Math.abs(amountBaseMinor / amountMinor) * 10 ** (currencyInfo(currency).exponent - currencyInfo(base).exponent);
  return rate > 0 && Number.isFinite(rate) ? rate : null;
}

/**
 * The posting lines a purchase's money reads as on this device (spec §7.4, corrected). The category lines post with
 * the figure the payer's device carried in the book's currency, never re-derived, so every device holds the same
 * number. The money side: on the payer's own device, while the purchase is still theirs, their own accounts, with a
 * changed total on the largest entry of each currency; anywhere else, one entry per currency on the payer's
 * placeholder.
 */
async function postingLines(tx: Db, ctx: BookContext, head: string | null, money: PurchaseMoney): Promise<{ lines: PostingLine[]; ratesToBase: Record<string, number> }> {
  const lines: PostingLine[] = [];
  const perCurrency = new Map<string, { amount: number; base: number }>();
  const ratesToBase: Record<string, number> = {};
  for (const line of money.lines) {
    lines.push({
      accountId: await localCategory(tx, ctx, line.categoryId),
      amountMinor: line.amountMinor,
      currency: line.currency,
      amountBaseMinor: line.amountBaseMinor,
      memo: line.memo,
    });
    const sum = perCurrency.get(line.currency) ?? { amount: 0, base: 0 };
    sum.amount += line.amountMinor;
    sum.base += line.amountBaseMinor;
    perCurrency.set(line.currency, sum);
    if (line.currency !== ctx.ws.baseCurrency && ratesToBase[line.currency] === undefined) {
      const rate = rateFromPair(line.currency, ctx.ws.baseCurrency, line.amountMinor, line.amountBaseMinor);
      if (rate !== null) ratesToBase[line.currency] = rate;
    }
  }

  const own =
    money.paidBy === ctx.memberId && head
      ? (
          await tx.values<[string, number, string, string | null, string | null]>(sql`
            SELECT e.account_id, e.amount_minor, e.currency, e.memo, e.spend_category_id
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.transaction_id = ${head} AND a.kind NOT IN ('income', 'expense')
              AND e.account_id NOT IN (SELECT account_id FROM book_member_accounts)
            ORDER BY e.rowid`)
        ).map(([accountId, amountMinor, currency, memo, spendCategoryId]) => ({ accountId, amountMinor: Number(amountMinor), currency, memo, spendCategoryId }))
      : [];

  for (const [currency, sum] of perCurrency) {
    const target = -sum.amount;
    if (target === 0) continue;
    const mine = own.filter((entry) => entry.currency === currency);
    if (mine.length === 0) {
      lines.push({ accountId: await placeholderAccountTx(tx, ctx, money.paidBy, currency), amountMinor: target, currency });
      continue;
    }
    const diff = target - mine.reduce((s, entry) => s + entry.amountMinor, 0);
    if (diff !== 0) {
      const largest = mine.reduce((a, b) => (Math.abs(b.amountMinor) > Math.abs(a.amountMinor) ? b : a));
      largest.amountMinor += diff;
    }
    for (const entry of mine) if (entry.amountMinor !== 0) lines.push(entry);
  }
  return { lines, ratesToBase };
}

/**
 * The ledger input for a purchase as it should now read (§7.4). Every fact that is not a winner stays `undefined`, so
 * `replaceTransactionTx` carries it exactly as when the payer edits it themselves; a `null` would clear it.
 */
async function ledgerInput(tx: Db, ctx: BookContext, head: string | null, state: PurchaseFields, winners: Record<string, unknown>, author: string): Promise<PostTransactionInput> {
  const { lines, ratesToBase } = await postingLines(tx, ctx, head, state.money);
  const input: PostTransactionInput = { occurredOn: state.occurredOn, description: state.description, lines, ratesToBase, syncAuthor: author };
  if ('channel' in winners) input.channel = state.channel;
  if ('excluded' in winners) input.excludedFromReport = state.excluded === 1;
  if ('bill' in winners) {
    input.templateId = state.bill?.templateId ?? null;
    input.billMonth = state.bill?.billMonth ?? null;
  }
  if ('money' in winners) {
    input.originalCurrency = state.money.originalCurrency;
    input.originalAmountMinor = state.money.originalAmountMinor;
  }
  return input;
}

async function recordPurchaseClocks(tx: Db, ctx: BookContext, lineageId: string, fields: Record<string, unknown>, hlc: string): Promise<void> {
  for (const field of Object.keys(fields)) await setClock(tx, ctx, 'purchase', lineageId, field, hlc);
}

/** A purchase op for a lineage this device has not seen, without the money to post it: kept until its page ends. */
export type HeldOps = Map<string, { op: Extract<Op, { op: 'upsert' }>; changeSet: ChangeSet }[]>;

/** §7.2 `applyPurchase`. Returns false when the op had to be held. */
async function applyPurchase(tx: Tx, ctx: BookContext, op: Extract<Op, { op: 'upsert' }>, changeSet: ChangeSet): Promise<boolean> {
  const lineage = await lineageOf(tx, op.id);
  if (lineage && lineage.head === null) return true; // void wins, for ever
  const winners = await winnersOf(tx, ctx, op, changeSet.hlc);
  if (Object.keys(winners).length === 0) return true;
  if (!lineage) {
    if (!('money' in winners) || winners.void) return false;
  }
  if (winners.void) {
    await voidTransactionTx(tx, ctx.ws, lineage!.head!, {}, changeSet.member);
    await tx.run(sql`UPDATE sync_lineage SET head_transaction_id = NULL WHERE lineage_id = ${op.id}`);
    await recordPurchaseClocks(tx, ctx, op.id, winners, changeSet.hlc);
    return true;
  }
  const current = lineage ? await projectPurchase(tx, lineage.head!, ctx.memberId, lineage) : null;
  const state = { ...(current ?? {}), ...winners } as PurchaseFields;
  const input = await ledgerInput(tx, ctx, lineage?.head ?? null, state, winners, changeSet.member);
  if (!lineage) {
    const id = await postTransactionTx(tx, ctx.ws, { ...input, id: op.id });
    await tx.run(
      sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${op.id}, ${ctx.bookId}, ${id}, ${state.money.paidBy}, ${state.money.paidLabel})`,
    );
  } else {
    const id = await replaceTransactionTx(tx, ctx.ws, lineage.head!, input);
    await tx.run(
      sql`UPDATE sync_lineage SET head_transaction_id = ${id}, paid_by = ${state.money.paidBy}, paid_label = ${state.money.paidLabel} WHERE lineage_id = ${op.id}`,
    );
  }
  await recordPurchaseClocks(tx, ctx, op.id, winners, changeSet.hlc);
  return true;
}

/* -------------------------------------------------------------- one change-set */

/** An op apply declines on purpose (a parent that is gone): recorded like a refusal. */
class SkipOp extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkipOp';
  }
}

/** Refusals every receiver makes alike, from the carried data alone (§7.1, task 4 fix round 1). */
const SKIPPABLE_POSTING = new Set(['TOO_FEW_LINES', 'ZERO_AMOUNT', 'UNBALANCED', 'NOT_INTEGER']);
const SKIPPABLE_LEDGER = new Set(['INVALID_DATE', 'INVALID_ORIGINAL', 'INVALID_MCC', 'INVALID_BILL_MONTH']);

/** The refusal in an error's cause chain that every receiver would make alike, or null (a bug: rethrow). */
function deterministicRefusal(error: unknown): { name?: string; code?: string; message?: string } | null {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth += 1) {
    const found = e as { name?: string; code?: string; message?: string };
    const { name, code } = found;
    if (name === 'SkipOp') return found;
    if (name === 'PostingError' && code && SKIPPABLE_POSTING.has(code)) return found;
    if (name === 'LedgerError' && code && SKIPPABLE_LEDGER.has(code)) return found;
    // CHECK and NOT NULL follow from the carried data alone; UNIQUE and FOREIGN KEY depend on rows only this device
    // has, so they stop the loop instead (task 4 fix round 2).
    if (code === 'SQLITE_CONSTRAINT_CHECK' || code === 'SQLITE_CONSTRAINT_NOTNULL') return found;
  }
  return null;
}

/** One op apply skipped: recorded in `sync_skipped` and reported by `pullAndApply`. */
export interface SkippedOp {
  seq: number;
  entity: string;
  id: string;
  error: string;
}

/** What one entry's apply is part of: its seq, and the skips it adds to. */
export interface ApplyRun {
  seq: number;
  skipped: SkippedOp[];
}

let savepoints = 0;

/**
 * Runs one op in a savepoint. A refusal every receiver would make alike is rolled back to the savepoint, recorded
 * durably in `sync_skipped`, and the entry goes on; anything else is a bug and is rethrown, so the entry's whole
 * transaction rolls back and the cursor stays before it (§7.1 stop).
 */
async function guarded(tx: Db, ctx: BookContext, run: ApplyRun, op: Op, fn: () => Promise<void>): Promise<void> {
  const name = sql.raw(`apply_op_${(savepoints += 1)}`);
  await tx.run(sql`SAVEPOINT ${name}`);
  try {
    await fn();
    await tx.run(sql`RELEASE ${name}`);
  } catch (error) {
    await tx.run(sql`ROLLBACK TO ${name}`);
    await tx.run(sql`RELEASE ${name}`);
    const refusal = deterministicRefusal(error);
    if (!refusal) throw error;
    const message = `${refusal.code ?? refusal.name}: ${refusal.message}`;
    const skip: SkippedOp = { seq: run.seq, entity: op.entity, id: op.id, error: message };
    await tx.run(
      sql`INSERT INTO sync_skipped (book_id, seq, entity, id, error, at) VALUES (${ctx.bookId}, ${skip.seq}, ${skip.entity}, ${skip.id}, ${skip.error}, ${new Date().toISOString()})`,
    );
    run.skipped.push(skip);
  }
}

/** §7.2, inside the caller's transaction, capture already off. Held purchase ops go into `held`. */
export async function applyChangeSetTx(tx: Tx, ctx: BookContext, changeSet: ChangeSet, held: HeldOps = new Map(), run: ApplyRun = { seq: 0, skipped: [] }): Promise<void> {
  await receiveHlc(tx, changeSet.hlc);
  for (const op of changeSet.ops) {
    const entity = entityOf(op.entity);
    if (entity.kind === 'purchase') {
      if (op.op !== 'upsert') continue; // a purchase is never deleted, only voided
      await guarded(tx, ctx, run, op, async () => {
        if (!(await applyPurchase(tx, ctx, op, changeSet))) held.set(op.id, [...(held.get(op.id) ?? []), { op, changeSet }]);
      });
      continue;
    }
    await guarded(tx, ctx, run, op, () => applyRowOp(tx, ctx, entity, op, changeSet.hlc));
  }
  // A held op whose lineage this change-set started is applied now, its clocks deciding as for any op.
  for (const [lineageId, ops] of [...held]) {
    if (!(await lineageOf(tx, lineageId))) continue;
    held.delete(lineageId);
    for (const { op, changeSet: from } of ops) await guarded(tx, ctx, run, op, async () => void (await applyPurchase(tx, ctx, op, from)));
  }
}

/** One change-set in its own transaction, capture off (§7.2). What tests and a re-apply reach for. */
export async function applyChangeSet(database: Database, bookId: string, changeSet: ChangeSet): Promise<void> {
  await database.transaction((tx) => withCapturePaused(tx, async () => applyChangeSetTx(tx, await bookContextTx(tx, bookId), changeSet), changeSet));
}

/* ------------------------------------------------------------------ the loop */

export interface PullResult {
  /** Entries this call moved the cursor past. */
  applied: number;
  /** Ops skipped as refusals every receiver makes alike, each also kept in `sync_skipped`. */
  skipped: SkippedOp[];
  /** Why the loop stopped before the end of the log, and at which entry; the cursor stays before it (§7.1). */
  stopped?: { seq: number; reason: 'bad signature' | 'drift' | 'not active' | 'needs invite' };
  /** Removals applied by this call, with the epoch each was made under — what `maybeRotate` looks at (§8.4). */
  removals: { epoch: number; target: string }[];
  /** Devices this call pinned for the first time (§5.4), by id. */
  introduced: string[];
}

async function cursorOf(database: Database, bookId: string): Promise<number> {
  const [row] = await database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`);
  return row ? Number(row[0]) : 0;
}

async function setCursorTx(tx: Db, bookId: string, seq: number): Promise<void> {
  await tx.run(sql`INSERT INTO sync_cursor (book_id, applied_seq) VALUES (${bookId}, ${seq}) ON CONFLICT (book_id) DO UPDATE SET applied_seq = excluded.applied_seq`);
}

/** The signing key this device has pinned for a device of the book (§5.4), or none yet. */
async function pinnedKeyOf(database: Database, bookId: string, deviceId: string): Promise<JsonWebKey | null> {
  const [row] = await database.db.values<[string]>(sql`SELECT sign_jwk FROM book_devices WHERE book_id = ${bookId} AND device_id = ${deviceId}`);
  return row ? (JSON.parse(row[0]) as JsonWebKey) : null;
}

const jwkOf = (value: unknown): JsonWebKey | null => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JsonWebKey;
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as JsonWebKey) : null;
};

/**
 * §5.4: an entry from a device this device has not pinned is trusted only as that device's introduction — a `change`
 * whose change-set upserts the author's own `device` row, whose `signJwk` is the key the relay supplied, derives to the
 * author's id, and verifies the entry's signature. Anything else from an unpinned device is refused.
 */
async function verifiesAsIntroduction(entry: SequencedEntry, changeSet: ChangeSet): Promise<boolean> {
  const intro = changeSet.ops.find((op) => op.entity === 'device' && op.id === entry.deviceId && op.op === 'upsert');
  if (!intro || intro.op !== 'upsert') return false;
  const inner = jwkOf(intro.fields.signJwk);
  if (!inner) return false;
  const [innerId, relayId] = await Promise.all([deviceIdOf({ signJwk: inner }).catch(() => null), deviceIdOf({ signJwk: entry.signJwk }).catch(() => null)]);
  if (innerId !== entry.deviceId || relayId !== entry.deviceId) return false;
  return verifyEntry(inner, entry);
}

/**
 * §7.1: pull from the cursor and apply, entry by entry, each in one transaction with the cursor's advance. The
 * cursor never passes an entry that was not applied: a bad signature, a missing epoch key or a change-set from too
 * far in the future stops the loop where it is. An entry this device wrote is already true here and only moves the
 * cursor. A signature is checked against the key pinned in `book_devices`; a device's first entry must introduce it
 * (§5.4). A rotation stores the new epoch key sealed for this device, if any (§5.3).
 */
export async function pullAndApply(
  database: Database,
  transport: SyncTransport,
  sealer: Sealer,
  bookId: string,
  now: () => number = Date.now,
  seen?: Set<string>,
): Promise<PullResult> {
  const [shared] = await database.db.values<[string, string]>(sql`SELECT relay_book_id, state FROM shared_books WHERE book_id = ${bookId}`);
  const removals: PullResult['removals'] = [];
  const introduced: string[] = [];
  if (!shared || shared[1] !== 'active') return { applied: 0, skipped: [], stopped: { seq: await cursorOf(database, bookId), reason: 'not active' }, removals, introduced };
  const relayBookId = shared[0];
  const self = sealer.deviceId;
  let since = await cursorOf(database, bookId);
  let applied = 0;
  const held: HeldOps = new Map();
  const skipped: SkippedOp[] = [];
  for (;;) {
    const { entries } = await transport.pull(relayBookId, since);
    if (entries.length === 0) break;
    for (const entry of entries) {
      let changeSet: ChangeSet | null = null;
      const openChange = async (): Promise<ChangeSet | 'missing'> => {
        try {
          return await sealer.open(bookId, entry as ChangeLogEntry);
        } catch (error) {
          if (error instanceof MissingEpochKeyError) return 'missing';
          throw error;
        }
      };
      const pinned = await pinnedKeyOf(database, bookId, entry.deviceId);
      if (pinned) {
        if (!(await verifyEntry(pinned, entry))) return finish({ seq: entry.seq, reason: 'bad signature' });
      } else {
        if (entry.kind !== 'change') return finish({ seq: entry.seq, reason: 'bad signature' });
        const opened = await openChange().catch(() => null);
        if (opened === 'missing') return needsInvite(entry.seq);
        if (!opened || !(await verifiesAsIntroduction(entry, opened))) return finish({ seq: entry.seq, reason: 'bad signature' });
        changeSet = opened;
        introduced.push(entry.deviceId);
      }
      if (entry.kind === 'change' && entry.deviceId !== self) {
        if (!changeSet) {
          const opened = await openChange();
          if (opened === 'missing') return needsInvite(entry.seq);
          changeSet = opened;
        }
        if (driftBlocks(decodeHlc(changeSet.hlc).ms, now())) return finish({ seq: entry.seq, reason: 'drift' });
        if (seen) for (const op of changeSet.ops) seen.add(`${op.entity}\u0000${op.id}`);
      } else if (entry.kind === 'change') {
        changeSet = null; // our own: already true here
      }
      let rotationKey: Uint8Array | null = null;
      if (entry.kind === 'rotation') {
        const mine = entry.sealed.find((sealed) => sealed.deviceId === self && sealed.epoch === entry.epoch);
        rotationKey = mine ? await openSealedKey(sealer.device.agree.privateKey, bookId, mine).catch(() => null) : null;
      }
      await database.transaction((tx) =>
        withCapturePaused(tx, async () => {
          const run: ApplyRun = { seq: entry.seq, skipped: [] };
          if (changeSet) await applyChangeSetTx(tx, await bookContextTx(tx, bookId), changeSet, held, run);
          if (entry.kind === 'removal') await applyRemovalTx(tx, await bookContextTx(tx, bookId), entry.target, entry.hlc);
          if (entry.kind === 'rotation') {
            await receiveHlc(tx, entry.hlc);
            // Not sealed for this device: it was added after the rotator last pulled. Its next entry under the new
            // epoch stops the loop as `needs invite`.
            if (rotationKey) {
              await sealer.storeEpochKeyTx(tx, bookId, entry.epoch, rotationKey);
              await tx.run(sql`UPDATE shared_books SET epoch = max(epoch, ${entry.epoch}) WHERE book_id = ${bookId}`);
            }
          }
          skipped.push(...run.skipped);
          await setCursorTx(tx, bookId, entry.seq);
        }, changeSet ?? undefined),
      );
      if (entry.kind === 'removal') removals.push({ epoch: entry.epoch, target: entry.target });
      since = entry.seq;
      applied += 1;
    }
  }
  return finish();

  async function needsInvite(seq: number): Promise<PullResult> {
    await database.db.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
    return finish({ seq, reason: 'needs invite' });
  }

  function finish(stopped?: PullResult['stopped']): PullResult {
    for (const lineageId of held.keys()) console.warn(`sync: purchase ${lineageId} changed but its money never arrived; dropped`);
    return stopped ? { applied, skipped, stopped, removals, introduced } : { applied, skipped, removals, introduced };
  }
}

/**
 * A removal entry (§8.4): the device's `removedAt`, with a clock at the entry's hlc like any field, so a later edit of
 * another field from a device that has not seen the removal cannot undo it. The value is the entry's own time, the same
 * on every device. The author applies its own removal too.
 */
async function applyRemovalTx(tx: Tx, ctx: BookContext, deviceId: string, hlc: string): Promise<void> {
  await receiveHlc(tx, hlc);
  const clock = await clockOf(tx, ctx, 'device', deviceId, 'removedAt');
  if (clock !== null && clock >= hlc) return;
  const at = new Date(decodeHlc(hlc).ms).toISOString();
  await tx.run(sql`UPDATE book_devices SET removed_at = ${at} WHERE book_id = ${ctx.bookId} AND device_id = ${deviceId}`);
  await setClock(tx, ctx, 'device', deviceId, 'removedAt', hlc);
}
