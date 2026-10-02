import { currencyInfo, type PostingLine, uuidv7 } from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { postTransactionTx, replaceTransactionTx, voidTransactionTx, type PostTransactionInput } from '../repos/ledger';
import { categoryInUseMessage, categoryUsesTx, removeCategorySettingsTx } from '../repos/category-delete';
import { activeNetWorthGroup } from '../repos/net-worth-sharing';
import { isRevivable, paidFromOf, projectPurchase, ROW_CLOCK, withCapturePaused, type PaidFrom, type PurchaseFields, type PurchaseMoney } from './capture';
import { decodeHlc, driftBlocks, receiveHlc } from './hlc';
import {
  AuthorityError,
  authorMemberOf,
  decideOpsTx,
  groupLogWorkspaceOf,
  NO_REVIVE,
  viewMember,
  introductionRefusal,
  recordRemovalTx,
  removalRefusal,
  removedInView,
  viewDevice,
  wasRefused,
} from './authority';
import { openSealedKey } from './crypto';
import { deviceIdOf } from './relay-signing';
import { MissingEpochKeyError, verifyEntry, type ChangeLogEntry, type Sealer } from './seal';
import { entityOf, NEVER_SYNCED_COLUMNS, parseOpId, type RowEntity } from './shared-entities';
import type { ChangeSet, Op, SequencedEntry, SyncTransport } from './types';
import { keepClocksTx, type SeenLog } from './seed';
import { postTransferSideTx } from './net-worth/transfers';
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
  let [row] = await tx.values<[string, string, string, string]>(sql`
    SELECT b.workspace_id, w.base_currency, b.base_currency, s.member_id
    FROM books b JOIN workspaces w ON w.id = b.workspace_id JOIN shared_books s ON s.book_id = b.id
    WHERE b.id = ${bookId}`);
  if (!row) {
    // A net-worth group log (joint-net-worth §4, task 4) has no `books` row: its workspace and currency are those of
    // the workspace it belongs to on this device (`nw_group_books`), and its member is this device's in the group log.
    [row] = await tx.values<[string, string, string, string]>(sql`
      SELECT b.workspace_id, w.base_currency, b.base_currency, s.member_id
      FROM nw_group_books g JOIN books b ON b.id = g.book_id JOIN workspaces w ON w.id = b.workspace_id JOIN shared_books s ON s.book_id = g.group_book_id
      WHERE g.group_book_id = ${bookId}`);
  }
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
 * The clock a carried field is sent at (`op.clocks`), never later than its change-set (re-review, NEW-1): an honest
 * sender's clocks come from its own `sync_field_clocks` and are never ahead of the hlc it seals them under, so one that
 * is — a modified client pinning a field with a far-future clock — is taken at the change-set's hlc, alike on every device.
 */
export function carriedAt(at: string | undefined, hlc: string): string | undefined {
  return at !== undefined && at > hlc ? hlc : at;
}

/**
 * A purchase op's fields that beat their clocks (rule 1): no clock yet, or an older one, each field at the change-set's
 * hlc when the op names it as changed, else at the clock `clocks` gives it (a seed or a rejoin sending what it kept at
 * its own clock, recovery review N2). A field with neither does not compete.
 */
async function purchaseWinnersOf(tx: Db, ctx: BookContext, op: Extract<Op, { op: 'upsert' }>, hlc: string): Promise<Map<string, { value: unknown; hlc: string }>> {
  const winners = new Map<string, { value: unknown; hlc: string }>();
  const named = op.changed ?? Object.keys(op.fields);
  for (const [field, value] of Object.entries(op.fields)) {
    const at = named.includes(field) ? hlc : carriedAt(op.clocks?.[field], hlc);
    if (at === undefined) continue;
    const clock = await clockOf(tx, ctx, op.entity, op.id, field);
    if (clock === null || at > clock) winners.set(field, { value, hlc: at });
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
    const at = changed.includes(field) ? hlc : carriedAt(op.clocks?.[field], hlc);
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
  category_colour: { table: 'accounts', from: 'key', name: 'category_account_id' },
  budget: { table: 'accounts', from: 'field', name: 'categoryAccountId' },
  budget_override: { table: 'budgets', from: 'field', name: 'budgetId' },
  budget_frequency: { table: 'budgets', from: 'key', name: 'budget_id' },
  bill: { table: 'accounts', from: 'field', name: 'categoryAccountId' },
  bill_window: { table: 'expense_templates', from: 'key', name: 'template_id' },
  bill_skip: { table: 'expense_templates', from: 'key', name: 'template_id' },
  bill_pause: { table: 'expense_templates', from: 'key', name: 'template_id' },
};

function keyWhere(entity: RowEntity, key: Record<string, string>, ctx: BookContext): SQL {
  const parts = entity.keyColumns.map((column) => sql`${sql.raw(column)} = ${key[column]}`);
  if (entity.localOnInsert.includes('book_id') && !entity.keyColumns.includes('book_id')) parts.push(sql`book_id = ${ctx.bookId}`);
  if (entity.table === 'bill_skips' || entity.table === 'bill_pauses') parts.push(sql`workspace_id = ${ctx.ws.workspaceId}`);
  return sql.join(parts, sql` AND `);
}

async function rowExists(tx: Db, entity: RowEntity, where: SQL): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM ${sql.raw(entity.table)} WHERE ${where}`)).length > 0;
}

/** Deletes a row and what only made sense against it (a budget's frequency and overrides, a category's settings). */
async function deleteRow(tx: Db, entity: RowEntity, where: SQL, key: Record<string, string>): Promise<void> {
  if (entity.entity === 'budget') {
    await tx.run(sql`DELETE FROM budget_frequencies WHERE budget_id = ${key.id}`);
    await tx.run(sql`DELETE FROM budget_overrides WHERE budget_id = ${key.id}`);
  }
  if (entity.entity === 'category') await removeCategorySettingsTx(tx, key.id!);
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
  // Joint net worth §7.2: a transfer between partners once void stays void — a later op never brings it back.
  if (entity.entity === 'member_transfer' && exists && winners.has('void') && !Number(winners.get('void')!.value)) {
    const [stored] = await tx.values<[number]>(sql`SELECT void FROM member_transfers WHERE ${where}`);
    if (stored && Number(stored[0]) === 1) winners.delete('void');
  }
  const record = async () => {
    for (const [field, { hlc: at }] of winners) await setClock(tx, ctx, entity.entity, op.id, field, at);
  };
  // A non-owner's member edit never brings a deleted row back nor moves its existence clock (fix round 2, N1).
  const noRevive = NO_REVIVE.has(op);
  if (noRevive && !exists && tomb === null) return;
  if (tomb !== null) {
    if (!revivable) return;
    if (hlc <= tomb || noRevive) {
      // Still dead here, but its fields merge into what the tombstone kept, so a later revive reads them.
      if (winners.size === 0) return;
      const retained = await retainedOf(tx, ctx, entity.entity, op.id);
      for (const [field, { value }] of winners) retained[field] = value;
      await tx.run(sql`UPDATE sync_tombstones SET last_json = ${JSON.stringify(retained)} WHERE book_id = ${ctx.bookId} AND entity = ${entity.entity} AND id = ${op.id}`);
      await record();
      return;
    }
  }
  if (revivable && !noRevive) {
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
  paidFrom: PaidFrom | null;
}

async function lineageOf(tx: Db, lineageId: string): Promise<LineageRow | null> {
  const rows = await tx.values<[string | null, string, string, string | null, string | null]>(
    sql`SELECT head_transaction_id, paid_by, paid_label, paid_from_owner, paid_from_item FROM sync_lineage WHERE lineage_id = ${lineageId}`,
  );
  const row = rows[0];
  return row ? { head: row[0], paidBy: row[1], paidLabel: row[2], paidFrom: paidFromOf(row[3], row[4]) } : null;
}

/** A carried `paidFrom` as this device reads it: absent, or anything but two non-empty strings, is null (§5.3). */
function carriedPaidFrom(value: unknown): PaidFrom | null {
  if (!value || typeof value !== 'object') return null;
  const { owner, itemId } = value as Record<string, unknown>;
  return typeof owner === 'string' && typeof itemId === 'string' ? paidFromOf(owner, itemId) : null;
}

/** Who may land a purchase on this device's own item (task 7 review round 1): the op's author and what the lineage had. */
interface PaidFromTrust {
  /** The member the signing device writes as, per the authority view (`authorMemberOf`) — never `changeSet.member`. */
  authorMember: string | null;
  /** The `paidFrom` the lineage already carried here, and the head it is posted as. */
  known: PaidFrom | null;
  head: string | null;
}

/**
 * The local account a `paidFrom` names on its owner's phone (§5.3): the account `nw_item_map` maps the item to, or null —
 * and the money side goes on the paying member's placeholder. Only while this person's net-worth group is active, is
 * this workspace's, and the map is that group's; only in the line's currency; and only when the op's author is a
 * member of the group. A purchase that already sits on one of this device's own accounts with the same `paidFrom`
 * stays there, group or no group (an ordinary edit keeps it; §7.1 "already recorded stay", final review item 2). So
 * nobody outside the group, and no former partner once it has ended, can put a new purchase on the owner's real card
 * (task 7 review round 1). The card is the one the head already names on that account (a supplementary
 * card), else the account's primary.
 */
async function paidFromAccountHere(
  tx: Db,
  ctx: BookContext,
  paidFrom: PaidFrom,
  currency: string,
  trust: PaidFromTrust,
): Promise<{ accountId: string; cardId: string | null } | null> {
  const unchangedFrom = trust.known !== null && trust.known.owner === paidFrom.owner && trust.known.itemId === paidFrom.itemId && trust.head !== null;
  if (unchangedFrom) {
    // Final review item 2: a purchase already recorded on this member's own item stays there (§7.1) — whether the group
    // is still active, has ended (its map forgotten), or its log is waiting on an invite after a restore. Same
    // `paidFrom` as the lineage knows, and the head already has its money side, in this currency, on one of this
    // device's own accounts: keep that account (and card).
    const [held] = await tx.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${trust.head} AND e.currency = ${currency} AND a.kind IN ('asset', 'liability')
        AND e.account_id NOT IN (SELECT account_id FROM book_member_accounts)
      ORDER BY e.rowid LIMIT 1`);
    if (held) return cardHere(tx, held[0], trust.head);
  }
  if ((await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nw_item_map'`)).length === 0) return null;
  const group = await activeNetWorthGroup(tx);
  if (!group || group.workspaceBookId !== ctx.bookId || group.me !== paidFrom.owner) return null;
  const [row] = await tx.values<[string]>(sql`
    SELECT m.account_id FROM nw_item_map m JOIN accounts a ON a.id = m.account_id
    WHERE m.item_id = ${paidFrom.itemId} AND m.group_book_id = ${group.groupBookId} AND a.currency = ${currency}
      AND a.kind IN ('asset', 'liability') AND a.id NOT IN (SELECT account_id FROM book_member_accounts)`);
  if (!row) return null;
  const accountId = row[0];
  // Only a group member lands a purchase here; one already on this account with the same `paidFrom` was kept above.
  if (trust.authorMember === null || !group.members.includes(trust.authorMember)) return null;
  return cardHere(tx, accountId, trust.head);
}

/** The card a purchase on `accountId` names: the one the head already names on it (a supplementary card), else its primary. */
async function cardHere(tx: Db, accountId: string, head: string | null): Promise<{ accountId: string; cardId: string | null }> {
  const [kept] = head
    ? await tx.values<[string]>(sql`SELECT c.id FROM transactions t JOIN cards c ON c.id = t.card_id WHERE t.id = ${head} AND c.account_id = ${accountId}`)
    : [];
  if (kept) return { accountId, cardId: kept[0] };
  const [card] = await tx.values<[string]>(
    sql`SELECT id FROM cards WHERE account_id = ${accountId} AND archived_at IS NULL ORDER BY is_primary DESC, created_at, id LIMIT 1`,
  );
  return { accountId, cardId: card?.[0] ?? null };
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
 *
 * Joint net worth §5.3: the money side is the **account owner's** — `paidFrom?.owner ?? paidBy`. On the owner's phone a
 * purchase paid from their item posts on the item's own account (and card), so its statement, cycle and points see it;
 * everywhere else on the owner's placeholder. On the owner's phone a purchase that may not land there (see
 * `paidFromAccountHere`) goes on the paying member's placeholder, never this member's own: it is not this member's
 * spending. `cardId` is the card the row should now name: undefined keeps the head's.
 */
async function postingLines(
  tx: Db,
  ctx: BookContext,
  head: string | null,
  money: PurchaseMoney,
  trust: PaidFromTrust,
): Promise<{ lines: PostingLine[]; ratesToBase: Record<string, number>; cardId: string | null | undefined; refused: boolean }> {
  const lines: PostingLine[] = [];
  let refused = false;
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

  const accountOwner = money.paidFrom?.owner ?? money.paidBy;
  let cardId: string | null | undefined;
  const own =
    money.paidBy === ctx.memberId && accountOwner === ctx.memberId && head
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
      const item = money.paidFrom && accountOwner === ctx.memberId ? await paidFromAccountHere(tx, ctx, money.paidFrom, currency, trust) : null;
      if (item) {
        lines.push({ accountId: item.accountId, amountMinor: target, currency });
        cardId = item.cardId;
      } else {
        // Not landed on the owner's item here: the payer's placeholder (task 7 review round 1), as for any other purchase.
        if (money.paidFrom && accountOwner === ctx.memberId) refused = true;
        const holder = accountOwner === ctx.memberId ? money.paidBy : accountOwner;
        lines.push({ accountId: await placeholderAccountTx(tx, ctx, holder, currency), amountMinor: target, currency });
        if (cardId === undefined && own.length === 0) cardId = null;
      }
      continue;
    }
    const diff = target - mine.reduce((s, entry) => s + entry.amountMinor, 0);
    if (diff !== 0) {
      const largest = mine.reduce((a, b) => (Math.abs(b.amountMinor) > Math.abs(a.amountMinor) ? b : a));
      largest.amountMinor += diff;
    }
    for (const entry of mine) if (entry.amountMinor !== 0) lines.push(entry);
  }
  return { lines, ratesToBase, cardId, refused };
}

/**
 * The ledger input for a purchase as it should now read (§7.4). Every fact that is not a winner stays `undefined`, so
 * `replaceTransactionTx` carries it exactly as when the payer edits it themselves; a `null` would clear it.
 */
async function ledgerInput(
  tx: Db,
  ctx: BookContext,
  head: string | null,
  state: PurchaseFields,
  winners: Record<string, unknown>,
  author: string,
  trust: PaidFromTrust,
): Promise<{ input: PostTransactionInput; refused: boolean }> {
  const { lines, ratesToBase, cardId, refused } = await postingLines(tx, ctx, head, state.money, trust);
  const input: PostTransactionInput = { occurredOn: state.occurredOn, description: state.description, lines, ratesToBase, syncAuthor: author };
  // The card the money side is now on (§5.3): the owner's card, or none once it sits on a placeholder.
  if (cardId !== undefined) input.cardId = cardId;
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
  return { input, refused };
}

async function recordPurchaseClocks(tx: Db, ctx: BookContext, lineageId: string, won: ReadonlyMap<string, { hlc: string }>): Promise<void> {
  for (const [field, { hlc }] of won) await setClock(tx, ctx, 'purchase', lineageId, field, hlc);
}

/** A purchase op for a lineage this device has not seen, without the money to post it: kept until its page ends, with the seq it came at. */
export type HeldOps = Map<string, { op: Extract<Op, { op: 'upsert' }>; changeSet: ChangeSet; seq: number; author: string }[]>;

/** §7.2 `applyPurchase`. Returns false when the op had to be held. */
async function applyPurchase(tx: Tx, ctx: BookContext, op: Extract<Op, { op: 'upsert' }>, changeSet: ChangeSet, authorDevice: string): Promise<boolean> {
  const lineage = await lineageOf(tx, op.id);
  if (lineage && lineage.head === null) return true; // void wins, for ever
  const won = await purchaseWinnersOf(tx, ctx, op, changeSet.hlc);
  if (won.size === 0) return true;
  const winners = Object.fromEntries([...won].map(([field, { value }]) => [field, value]));
  if (!lineage) {
    // A void for a purchase never posted here (a share made again sends every void it holds, recovery review N2):
    // void wins for ever, so the lineage is known as void, and any money that comes for it later is dropped by it.
    if (winners.void) {
      await tx.run(sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${op.id}, ${ctx.bookId}, NULL, '', '')`);
      await recordPurchaseClocks(tx, ctx, op.id, won);
      return true;
    }
    if (!('money' in winners)) return false;
  }
  if (winners.void) {
    await voidTransactionTx(tx, ctx.ws, lineage!.head!, {}, changeSet.member);
    await tx.run(sql`UPDATE sync_lineage SET head_transaction_id = NULL WHERE lineage_id = ${op.id}`);
    await recordPurchaseClocks(tx, ctx, op.id, won);
    return true;
  }
  const current = lineage ? await projectPurchase(tx, lineage.head!, ctx.memberId, lineage) : null;
  const state = { ...(current ?? {}), ...winners } as PurchaseFields;
  state.money = { ...state.money, paidFrom: carriedPaidFrom(state.money.paidFrom) };
  const trust: PaidFromTrust = {
    authorMember: state.money.paidFrom?.owner === ctx.memberId ? await authorMemberOf(tx, ctx.bookId, authorDevice) : null,
    known: lineage?.paidFrom ?? null,
    head: lineage?.head ?? null,
  };
  const { input, refused } = await ledgerInput(tx, ctx, lineage?.head ?? null, state, winners, changeSet.member, trust);
  // Final review item 2: the lineage keeps the `paidFrom` in effect here — none when this device refused to land it on
  // its own item (the money side went on the payer's placeholder), so nothing reads it as on that item later.
  const from = refused ? null : state.money.paidFrom;
  if (!lineage) {
    const id = await postTransactionTx(tx, ctx.ws, { ...input, id: op.id });
    await tx.run(
      sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label, paid_from_owner, paid_from_item)
          VALUES (${op.id}, ${ctx.bookId}, ${id}, ${state.money.paidBy}, ${state.money.paidLabel}, ${from?.owner ?? null}, ${from?.itemId ?? null})`,
    );
  } else {
    const id = await replaceTransactionTx(tx, ctx.ws, lineage.head!, input);
    await tx.run(
      sql`UPDATE sync_lineage SET head_transaction_id = ${id}, paid_by = ${state.money.paidBy}, paid_label = ${state.money.paidLabel},
          paid_from_owner = ${from?.owner ?? null}, paid_from_item = ${from?.itemId ?? null} WHERE lineage_id = ${op.id}`,
    );
  }
  await recordPurchaseClocks(tx, ctx, op.id, won);
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
  /** Who wrote the entry (its signed `deviceId`); from the change-set's hlc when a test applies one directly. */
  author?: string;
  /** The book's first entry: its creator's seed, whose own member may be written as owner (§8.5). */
  creator?: boolean;
  /** The member an admitted introduction joins as, which it may write with the role 'member' (§8.5). */
  introducedMember?: string;
  /** Each op as the authority view decided it (`decideOpsTx`); worked out here when a test applies directly. */
  decisions?: (Op | AuthorityError)[];
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
    // An AuthorityError's own message already reads "AUTHORITY: ..." (authority.ts): recorded as-is, not doubled up
    // behind its class name, so every authority-refused skip's error starts the same way regardless of which check
    // raised it. Checked by type, not by sniffing the text (task 1 review round 1, finding 6): a plain `SkipOp` (a
    // parent gone here) shares `deterministicRefusal`'s name match but is not an authority refusal.
    const message = error instanceof AuthorityError ? error.message : `${refusal.code ?? refusal.name}: ${refusal.message}`;
    const skip: SkippedOp = { seq: run.seq, entity: op.entity, id: op.id, error: message };
    await tx.run(
      sql`INSERT INTO sync_skipped (book_id, seq, entity, id, error, at) VALUES (${ctx.bookId}, ${skip.seq}, ${skip.entity}, ${skip.id}, ${skip.error}, ${new Date().toISOString()})`,
    );
    run.skipped.push(skip);
  }
}

/** The category and the settings that go with it when it is deleted (`deleteCategory`). */
const CATEGORY_SETTINGS = new Set(['category', 'category_need', 'category_colour']);

/**
 * The categories a change-set deletes that this device has used meanwhile (a purchase posted into one before the
 * delete arrived, a budget or bill made on it, a subcategory filed under it), each with why it stays. Ruled: the
 * receiver keeps such a category, and its need mark and colour, and records the delete as a skip — so nothing here is
 * ever left pointing at a category that is gone. The deleting device files what later arrives for it under the book's
 * Uncategorised (rule 4), as for any category it does not know.
 */
async function categoriesKeptTx(tx: Db, ctx: BookContext, ops: readonly Op[]): Promise<Map<string, string>> {
  const kept = new Map<string, string>();
  for (const op of ops) {
    if (op.entity !== 'category' || op.op !== 'delete') continue;
    const [row] = await tx.values<[string]>(sql`SELECT name FROM accounts WHERE id = ${op.id} AND workspace_id = ${ctx.ws.workspaceId}`);
    if (!row) continue;
    const uses = await categoryUsesTx(tx, op.id);
    if (uses.length > 0) kept.set(op.id, `kept here: ${categoryInUseMessage(row[0], uses)}`);
  }
  return kept;
}

/** §7.2, inside the caller's transaction, capture already off. Held purchase ops go into `held`. */
export async function applyChangeSetTx(tx: Tx, ctx: BookContext, changeSet: ChangeSet, held: HeldOps = new Map(), run: ApplyRun = { seq: 0, skipped: [] }): Promise<void> {
  await receiveHlc(tx, changeSet.hlc);
  const author = run.author ?? decodeHlc(changeSet.hlc).deviceId;
  const decisions =
    run.decisions ?? (await decideOpsTx(tx, { bookId: ctx.bookId, author, hlc: changeSet.hlc, creator: run.creator ?? false, introducedMember: run.introducedMember }, changeSet.ops));
  const kept = await categoriesKeptTx(tx, ctx, changeSet.ops);
  for (const [index, original] of changeSet.ops.entries()) {
    const decision = decisions[index]!;
    const op = decision instanceof AuthorityError ? original : decision;
    const entity = entityOf(op.entity);
    if (entity.kind === 'purchase') {
      if (op.op !== 'upsert') continue; // a purchase is never deleted, only voided
      await guarded(tx, ctx, run, op, async () => {
        if (!(await applyPurchase(tx, ctx, op, changeSet, author))) held.set(op.id, [...(held.get(op.id) ?? []), { op, changeSet, seq: run.seq, author }]);
      });
      continue;
    }
    // Who may write what (task 5 fix rounds 1–2): a refused op is a recorded skip, the same on every device.
    await guarded(tx, ctx, run, op, async () => {
      if (decision instanceof AuthorityError) throw decision;
      const keptBecause = op.op === 'delete' && CATEGORY_SETTINGS.has(op.entity) ? kept.get(op.id) : undefined;
      if (keptBecause) throw new SkipOp(keptBecause);
      await applyRowOp(tx, ctx, entity, op, changeSet.hlc);
      // Joint net worth §7.2 (task 8): this device's side of a transfer between partners follows its row — posted only
      // for a party, while the group is active and the author (the authority view's, never the change-set's claim) is in it.
      if (entity.entity === 'member_transfer' && op.op === 'upsert') await postTransferSideTx(tx, ctx.bookId, op.id, await authorMemberOf(tx, ctx.bookId, author));
    });
  }
  // A held op whose lineage this change-set started is applied now, its clocks deciding as for any op.
  for (const [lineageId, ops] of [...held]) {
    if (!(await lineageOf(tx, lineageId))) continue;
    held.delete(lineageId);
    for (const { op, changeSet: from, author: by } of ops) await guarded(tx, ctx, run, op, async () => void (await applyPurchase(tx, ctx, op, from, by)));
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
  /**
   * `workspace behind` (joint-net-worth §4, task 4): a group log's entry introduces a device this device's view of the
   * linked workspace does not know yet. The pull waits for the workspace instead of refusing, so every device decides
   * the introduction against the same workspace pins.
   */
  stopped?: { seq: number; reason: 'bad signature' | 'drift' | 'not active' | 'needs invite' | 'workspace behind' };
  /**
   * Removals applied by this call, with the epoch each was made under — what `maybeRotate` looks at (§8.4) — and
   * whether it was a device leaving with its member (`leave`, a device removing itself; task 9a), at which seq.
   */
  removals: { epoch: number; target: string; seq: number; leave?: true }[];
  /** Devices this call pinned for the first time (§5.4), by id. */
  introduced: string[];
}

/** The device id an hlc carries, or null for one that is not an hlc at all. */
function hlcDeviceOf(hlc: string): string | null {
  try {
    return decodeHlc(hlc).deviceId;
  } catch {
    return null;
  }
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
async function verifiesAsIntroduction(bookId: string, entry: SequencedEntry, changeSet: ChangeSet): Promise<boolean> {
  const intro = changeSet.ops.find((op) => op.entity === 'device' && op.id === entry.deviceId && op.op === 'upsert');
  if (!intro || intro.op !== 'upsert') return false;
  const inner = jwkOf(intro.fields.signJwk);
  if (!inner) return false;
  const [innerId, relayId] = await Promise.all([deviceIdOf({ signJwk: inner }).catch(() => null), deviceIdOf({ signJwk: entry.signJwk }).catch(() => null)]);
  if (innerId !== entry.deviceId || relayId !== entry.deviceId) return false;
  return verifyEntry(inner, bookId, entry);
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
  seen?: SeenLog,
): Promise<PullResult> {
  const [shared] = await database.db.values<[string, string]>(sql`SELECT relay_book_id, state FROM shared_books WHERE book_id = ${bookId}`);
  const removals: PullResult['removals'] = [];
  const introduced: string[] = [];
  if (!shared || shared[1] !== 'active') return { applied: 0, skipped: [], stopped: { seq: await cursorOf(database, bookId), reason: 'not active' }, removals, introduced };
  const relayBookId = shared[0];
  const self = sealer.deviceId;
  // A net-worth group log admits by the linked workspace's pins (joint-net-worth §4): the workspace it belongs to.
  const groupWorkspace = await groupLogWorkspaceOf(database.db, bookId);
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
      let introducing = false;
      if (pinned) {
        if (!(await verifyEntry(pinned, bookId, entry))) return await finish({ seq: entry.seq, reason: 'bad signature' });
      } else if (await wasRefused(database.db, bookId, entry.deviceId)) {
        // Its introduction was refused: what it writes after is refused the same way, not a stop that blocks the book.
        await skipEntry(entry, entry.kind, entry.deviceId, 'AUTHORITY: its device was never admitted');
        continue;
      } else {
        if (entry.kind !== 'change') return await finish({ seq: entry.seq, reason: 'bad signature' });
        const opened = await openChange().catch(() => null);
        if (opened === 'missing') return needsInvite(entry.seq);
        if (!opened || !(await verifiesAsIntroduction(bookId, entry, opened))) return await finish({ seq: entry.seq, reason: 'bad signature' });
        changeSet = opened;
        introducing = true;
      }
      const own = entry.deviceId === self;
      if (entry.kind === 'change') {
        // Our own entries are opened too: their rows are already true here, but the authority view takes them in at
        // their seq like anyone's (fix round 2).
        if (!changeSet) {
          const opened = await openChange();
          if (opened === 'missing') return needsInvite(entry.seq);
          changeSet = opened;
        }
        // The change-set inside must be the one the signed envelope names.
        if (changeSet.hlc !== entry.hlc) return await finish({ seq: entry.seq, reason: 'bad signature' });
        // …and its hlc must carry the author's own id (§6.1): one stamped under another id — a stand-in minted before
        // the engine existed, say — is a recorded skip on every device alike (final review, I3).
        if (hlcDeviceOf(changeSet.hlc) !== entry.deviceId) {
          await skipEntry(entry, 'change', entry.deviceId, 'AUTHORITY: its hlc names another device than its author');
          continue;
        }
        if (!own && driftBlocks(decodeHlc(changeSet.hlc).ms, now())) return await finish({ seq: entry.seq, reason: 'drift' });
        // A group log's introduction of a device the linked workspace's view does not know yet waits for the workspace
        // (task 4 ruling): refusing now would be decided differently on a device whose workspace is further along.
        if (
          groupWorkspace !== null &&
          (await viewDevice(database.db, bookId, entry.deviceId)) === null &&
          (await viewDevice(database.db, groupWorkspace, entry.deviceId)) === null
        ) {
          return await finish({ seq: entry.seq, reason: 'workspace behind' });
        }
      }
      let rotationKey: Uint8Array | null = null;
      if (entry.kind === 'rotation') {
        const mine = entry.sealed.find((sealed) => sealed.deviceId === self && sealed.epoch === entry.epoch);
        rotationKey = mine ? await openSealedKey(sealer.device.agree.privateKey, bookId, mine).catch(() => null) : null;
      }
      let removal: PullResult['removals'][number] | null = null;
      let admitted = false;
      let applyingDecisions: (Op | AuthorityError)[] | undefined;
      await database.transaction((tx) =>
        withCapturePaused(tx, async () => {
          const run: ApplyRun = { seq: entry.seq, skipped: [], author: entry.deviceId };
          const refuse = async (entity: string, id: string, error: string) => {
            const skip: SkippedOp = { seq: entry.seq, entity, id, error };
            await tx.run(sql`INSERT INTO sync_skipped (book_id, seq, entity, id, error, at) VALUES (${bookId}, ${entry.seq}, ${entity}, ${id}, ${error}, ${new Date().toISOString()})`);
            run.skipped.push(skip);
          };
          const known = await viewDevice(tx, bookId, entry.deviceId);
          const viewIntro = entry.kind === 'change' && known === null;
          if (known?.removedSeq != null || (await removedInView(tx, bookId, entry.deviceId))) {
            // I2: its author was removed earlier in the log, whatever hlc it picked. Counts for nothing, anywhere.
            await refuse(entry.kind, entry.deviceId, 'AUTHORITY: written after its device was removed');
          } else if (entry.kind !== 'change' && known === null) {
            await refuse(entry.kind, entry.deviceId, 'AUTHORITY: its device was never admitted');
          } else {
            const introWhy = viewIntro && changeSet ? await introductionRefusal(tx, bookId, entry.deviceId, entry.seq, changeSet) : null;
            if (introWhy) {
              await refuse('device', entry.deviceId, introWhy);
            } else {
              admitted = viewIntro && !own;
              if (viewIntro && changeSet) {
                const intro = changeSet.ops.find((op) => op.entity === 'device' && op.id === entry.deviceId && op.op === 'upsert');
                if (intro && intro.op === 'upsert' && typeof intro.fields.memberId === 'string') run.introducedMember = intro.fields.memberId;
              }
              run.creator = viewIntro && entry.seq === 1;
              if (changeSet) {
                run.decisions = applyingDecisions = await decideOpsTx(
                  tx,
                  { bookId, author: entry.deviceId, hlc: changeSet.hlc, creator: run.creator, introducedMember: run.introducedMember, own, groupLog: groupWorkspace !== null },
                  changeSet.ops,
                );
                // A rejoin's pull (§8.7, N2) notes what the log says, as the view took it, for what it sends after.
                seen?.note(changeSet, run.decisions);
                if (!own) await applyChangeSetTx(tx, await bookContextTx(tx, bookId), changeSet, held, run);
                else {
                  // Our own rows are already as we wrote them; what peers refuse is recorded here too.
                  for (const [i, decision] of run.decisions.entries()) {
                    // decision.message already reads "AUTHORITY: ..." (authority.ts): recorded as-is, matching guarded()'s format.
                    if (decision instanceof AuthorityError) await refuse(changeSet.ops[i]!.entity, changeSet.ops[i]!.id, decision.message);
                  }
                  // …and whatever of our member edits the log did not take is put back to what it did (fix round 3).
                  const members = new Set(changeSet.ops.filter((op) => op.entity === 'member').map((op) => op.id));
                  if (members.size) await reconcileMembersTx(tx, await bookContextTx(tx, bookId), members, changeSet);
                }
              }
              if (entry.kind === 'removal') {
                const why = await removalRefusal(tx, bookId, entry.deviceId, entry.target);
                if (why) await refuse('removal', entry.target, why);
                else {
                  await recordRemovalTx(tx, bookId, entry.target, entry.seq);
                  await applyRemovalTx(tx, await bookContextTx(tx, bookId), entry.target, entry.hlc);
                  // Leave (§8.4, task 9a) counts only on a device removing itself.
                  const leave = entry.leave === true && entry.target === entry.deviceId;
                  removal = leave ? { epoch: entry.epoch, target: entry.target, seq: entry.seq, leave: true } : { epoch: entry.epoch, target: entry.target, seq: entry.seq };
                }
              }
              if (entry.kind === 'rotation') {
                await receiveHlc(tx, entry.hlc);
                // Not sealed for this device: it was added after the rotator last pulled. Its next entry under the new
                // epoch stops the loop as `needs invite`.
                if (rotationKey) {
                  await sealer.storeEpochKeyTx(tx, bookId, entry.epoch, rotationKey);
                  await tx.run(sql`UPDATE shared_books SET epoch = max(epoch, ${entry.epoch}) WHERE book_id = ${bookId}`);
                }
              }
            }
          }
          skipped.push(...run.skipped);
          await setCursorTx(tx, bookId, entry.seq);
        }, () => {
          // What apply took in from another device, without the ops the authority view refused (§6.4 harness).
          const decisions = applyingDecisions;
          if (own || !changeSet || !decisions) return undefined; // our own, or refused as a whole
          return { ...changeSet, ops: changeSet.ops.filter((_, i) => !(decisions[i] instanceof AuthorityError)) };
        }),
      );
      if (admitted) introduced.push(entry.deviceId);
      if (removal) removals.push(removal);
      since = entry.seq;
      applied += 1;
    }
  }
  return await finish();

  /** An entry refused as a whole, before anything of it is opened: recorded, and the cursor moves past it. */
  async function skipEntry(entry: SequencedEntry, entity: string, id: string, error: string): Promise<void> {
    await database.transaction(async (tx) => {
      await tx.run(sql`INSERT INTO sync_skipped (book_id, seq, entity, id, error, at) VALUES (${bookId}, ${entry.seq}, ${entity}, ${id}, ${error}, ${new Date().toISOString()})`);
      await setCursorTx(tx, bookId, entry.seq);
    });
    skipped.push({ seq: entry.seq, entity, id, error });
    since = entry.seq;
    applied += 1;
  }
  async function needsInvite(seq: number): Promise<PullResult> {
    // Nothing is captured while it waits: its clocks are kept with their values now (recovery review, N2).
    await database.transaction(async (tx) => {
      await keepClocksTx(tx, bookId);
      await tx.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
    });
    return await finish({ seq, reason: 'needs invite' });
  }

  /** What was held for money that never came is dropped as a recorded skip, never silently (final review, minor 6). */
  async function finish(stopped?: PullResult['stopped']): Promise<PullResult> {
    for (const [lineageId, ops] of held) {
      for (const { seq } of ops) {
        const skip: SkippedOp = { seq, entity: 'purchase', id: lineageId, error: 'HELD: the purchase changed but its money never arrived; dropped' };
        await database.db.run(sql`INSERT INTO sync_skipped (book_id, seq, entity, id, error, at) VALUES (${bookId}, ${skip.seq}, ${skip.entity}, ${skip.id}, ${skip.error}, ${new Date().toISOString()})`);
        skipped.push(skip);
      }
    }
    held.clear();
    return stopped ? { applied, skipped, stopped, removals, introduced } : { applied, skipped, removals, introduced };
  }
}

/**
 * After a rejoin's pull from 0 (§8.7, task 9a — S4): every member row of the book here is set to what the view decided.
 * A refused edit this device's backup made and drained before the backup was taken comes back from the log under the
 * old device's id, which is no longer "own": apply refuses it like anyone's, and the row the backup holds would keep
 * the refused value. Nothing is emitted.
 */
export async function reconcileAllMembersTx(tx: Tx, bookId: string): Promise<void> {
  const rows = await tx.values<[string]>(sql`SELECT member_id FROM book_members WHERE book_id = ${bookId}`);
  if (rows.length === 0) return;
  await reconcileMembersTx(tx, await bookContextTx(tx, bookId), new Set(rows.map(([id]) => id)), { v: 1, hlc: '', member: '', ops: [] });
}

/**
 * Puts this device's member rows back to what the authority view decided (fix round 3). Reached when the loop takes in
 * one of this device's own entries: an edit the log refused (a role only an owner may write, a delete, a re-make) or
 * one this device made from a view that lagged (an existence clock moved by a rename that crossed an owner's delete)
 * was already written here and never undone — so the row's role and its existence, with their clocks, are set to the
 * view's. Nothing is emitted: peers never took the edit in.
 */
async function reconcileMembersTx(tx: Tx, ctx: BookContext, memberIds: ReadonlySet<string>, changeSet: ChangeSet): Promise<void> {
  const entity = entityOf('member') as RowEntity;
  for (const memberId of memberIds) {
    const view = await viewMember(tx, ctx.bookId, memberId);
    const key = parseOpId(entity, memberId);
    const where = keyWhere(entity, key, ctx);
    const exists = await rowExists(tx, entity, where);
    if (!view) {
      // The log has never known this member: this device made the row and its introduction was refused (only an owner
      // makes a member), so no peer has it and nothing will ever take it in. It leaves here too, with its clocks and
      // tombstone, as if it had never been written (fix round 4).
      if (!exists) continue;
      await deleteRow(tx, entity, where, key);
      await tx.run(sql`DELETE FROM sync_field_clocks WHERE book_id = ${ctx.bookId} AND entity = 'member' AND id = ${memberId}`);
      await tx.run(sql`DELETE FROM sync_tombstones WHERE book_id = ${ctx.bookId} AND entity = 'member' AND id = ${memberId}`);
      continue;
    }
    if (view.deleted) {
      if (!exists) continue;
      await setTombstone(tx, ctx, 'member', memberId, view.rowHlc, await rowValuesOf(tx, entity, where));
      await tx.run(sql`UPDATE sync_tombstones SET hlc = ${view.rowHlc} WHERE book_id = ${ctx.bookId} AND entity = 'member' AND id = ${memberId}`);
      await deleteRow(tx, entity, where, key);
      await setClock(tx, ctx, 'member', memberId, ROW_CLOCK, view.rowHlc);
      continue;
    }
    if (!exists) {
      const kept = await retainedOf(tx, ctx, 'member', memberId);
      const op = changeSet.ops.find((o) => o.entity === 'member' && o.id === memberId && o.op === 'upsert');
      const carried = op && op.op === 'upsert' ? op.fields : {};
      const values: Record<string, unknown> = {};
      for (const field of Object.keys(entity.fields)) values[field] = field in kept ? kept[field] : carried[field];
      values.role = view.role;
      if (typeof values.name !== 'string' || typeof values.joinedAt !== 'string') {
        // Nothing here to rebuild it from: no tombstone kept its values and the op carried none. Left absent; the next
        // entry that names it whole brings it back.
        console.warn(`sync: member ${memberId} of book ${ctx.bookId} is alive in the log but this device has nothing to rebuild it from; left absent`);
        continue;
      }
      await tx.run(sql`DELETE FROM sync_tombstones WHERE book_id = ${ctx.bookId} AND entity = 'member' AND id = ${memberId}`);
      await insertRow(tx, ctx, entity, key, values, where);
      await setClock(tx, ctx, 'member', memberId, ROW_CLOCK, view.rowHlc);
    }
    const [row] = await tx.values<[string]>(sql`SELECT role FROM book_members WHERE ${where}`);
    if (row && row[0] !== view.role) await tx.run(sql`UPDATE book_members SET role = ${view.role} WHERE ${where}`);
    await setClock(tx, ctx, 'member', memberId, 'role', view.roleHlc);
    const [alive] = await tx.values<[string]>(sql`SELECT hlc FROM sync_field_clocks WHERE book_id = ${ctx.bookId} AND entity = 'member' AND id = ${memberId} AND field = ${ROW_CLOCK}`);
    if (alive && alive[0] > view.rowHlc) await setClock(tx, ctx, 'member', memberId, ROW_CLOCK, view.rowHlc);
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
