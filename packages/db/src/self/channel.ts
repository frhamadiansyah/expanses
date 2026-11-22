import { uuidv7 } from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { Database, Db, Tx } from '../database';
import { LATEST_VERSION } from '../migrations';
import { voidTransactionTx } from '../repos/ledger';
import { settleTwicePaidBillsTx } from '../repos/bill-settle';
import { AuthorityError } from '../sync/authority';
import { BookReadOnlyError, SyncNotReadyError, capturePostedTx, captureCardChangingTx, captureVoidingTx, LastOwnerError, MemberNameError, seatIsElsewhere, withCapture, withCapturePaused } from '../sync/capture';
import { OP_ID_SEPARATOR, SHARED_ENTITIES, type RowEntity } from '../sync/shared-entities';
import { compareHlc, decodeHlc, localTick, receiveHlc } from '../sync/hlc';
import { stableId } from './stable-id';
import { CLASH_RULES, type ClashRule, isUniqueFailure, uniqueKeysOf, type UniqueKey } from './clashes';
import { SELF_TABLES } from './tables';

export { installSelfCapture, removeSelfCapture } from './triggers';

/*
 * Link my devices, the self channel's change-sets (spec §3.2, §3.3). Between the owner's own devices, which start as
 * byte copies of one another, so a row has the same id everywhere and travels as it is: table, primary key, columns.
 *
 * Collect: every row the triggers marked, at its values now, under one clock reading. Apply, six plain rules:
 *   1. each column: the later clock wins;
 *   2. a removed row stays removed (only a fresh insert with a later clock brings it back);
 *   3. void stays void;
 *   4. one transaction edited on two devices apart: the later edit stays, the other is voided;
 *   5. a unique-key clash: merge, keep both, or hold, fixed per key (clashes.ts) — never a money row deleted;
 *   6. a change from a newer data version waits.
 * Nothing apply writes is captured again (`self_state` holds `quiet` for the length of it).
 */

export interface SelfOp {
  /** Table. */
  t: string;
  /** Primary key values, in the key's column order. */
  k: unknown[];
  /** Columns and their values: every column for a row just made (`i`), only the changed ones otherwise. */
  c?: Record<string, unknown>;
  /** The row was made: `c` holds all of it, so a device that does not hold it can insert it. */
  i?: true;
  /** The row was taken away. */
  d?: true;
}

export interface SelfChangeSet {
  v: 1;
  /** One clock reading for the whole set; its device id is the device that made it. */
  hlc: string;
  /** The data version (`LATEST_VERSION`) of the device that made it. */
  schema: number;
  ops: SelfOp[];
}

export interface SelfNote {
  kind: 'merged' | 'maybe-duplicate' | 'edited-twice' | 'edited-twice-kept-both' | 'missing-row' | 'not-shared';
  table: string;
  pk: string;
  other?: string;
}

export type SelfApplyResult =
  | { status: 'applied'; notes: SelfNote[] }
  | { status: 'held'; reason: 'newer-version' | 'household-not-ready'; schema: number }
  | { status: 'held'; reason: 'clash'; key: string; table: string; pk: string; other: string; why: string };

/* ------------------------------------------------------------------------------------------------------ schema */

interface TableMeta {
  table: string;
  columns: string[];
  keys: string[];
  /** Column → the table it references, for the aliases a merge leaves. */
  references: Map<string, string>;
  unique: UniqueKey[];
}

const metaCache = new Map<string, TableMeta>();

async function tableMeta(db: Db, table: string): Promise<TableMeta | null> {
  const [version] = await db.values<[number]>(sql`PRAGMA schema_version`);
  const cacheKey = `${version?.[0]}|${table}`;
  const cached = metaCache.get(cacheKey);
  if (cached) return cached;
  const columns = await db.values<[string, number]>(sql`SELECT name, pk FROM pragma_table_info(${table}) ORDER BY cid`);
  if (columns.length === 0) return null;
  const keys = columns.filter(([, pk]) => Number(pk) > 0).sort((a, b) => Number(a[1]) - Number(b[1])).map(([name]) => name);
  const references = new Map((await db.values<[string, string]>(sql`SELECT "from", "table" FROM pragma_foreign_key_list(${table})`)).map(([from, to]) => [from, to] as const));
  const meta: TableMeta = { table, columns: columns.map(([name]) => name), keys, references, unique: await uniqueKeysOf(db, table) };
  metaCache.set(cacheKey, meta);
  return meta;
}

const id = (name: string) => sql.identifier(name);
const pkText = (values: readonly unknown[]) => JSON.stringify(values);
const whereKey = (meta: TableMeta, pk: readonly unknown[]): SQL => sql.join(meta.keys.map((key, i) => sql`${id(key)} = ${pk[i] as string}`), sql` AND `);

async function readRow(db: Db, meta: TableMeta, pk: readonly unknown[]): Promise<Record<string, unknown> | null> {
  const [row] = await db.values<unknown[]>(sql`SELECT ${sql.join(meta.columns.map(id), sql`, `)} FROM ${id(meta.table)} WHERE ${whereKey(meta, pk)}`);
  return row ? Object.fromEntries(meta.columns.map((column, i) => [column, row[i]])) : null;
}

/* ------------------------------------------------------------------------------------------------------ clocks */

/** The clock of each column of a row here; '' is the row's own (when it was made). A row made before linking has none. */
async function clocksOf(db: Db, table: string, pk: string): Promise<Map<string, string>> {
  return new Map(await db.values<[string, string]>(sql`SELECT col, hlc FROM self_clocks WHERE tbl = ${table} AND pk = ${pk}`));
}

async function setClocks(db: Db, table: string, pk: string, columns: Iterable<string>, hlc: string): Promise<void> {
  for (const column of columns) {
    await db.run(sql`INSERT INTO self_clocks (tbl, pk, col, hlc) VALUES (${table}, ${pk}, ${column}, ${hlc})
      ON CONFLICT (tbl, pk, col) DO UPDATE SET hlc = CASE WHEN excluded.hlc > self_clocks.hlc THEN excluded.hlc ELSE self_clocks.hlc END`);
  }
}

async function tombstoneOf(db: Db, table: string, pk: string): Promise<string | undefined> {
  const [row] = await db.values<[string]>(sql`SELECT hlc FROM self_tombstones WHERE tbl = ${table} AND pk = ${pk}`);
  return row?.[0];
}

const later = (a: string | undefined, b: string | undefined) => compareHlc(a ?? '', b ?? '') > 0;
const maxClock = (clocks: Map<string, string>, columns: readonly string[]) => columns.reduce((top, column) => (later(clocks.get(column), top) ? clocks.get(column)! : top), clocks.get('') ?? '');

/* ------------------------------------------------------------------------------------------------------ collect */

/** One change-set's ops as JSON at most this big: deflated and sealed, it fits a 128 KB log entry even if nothing compresses. */
export const MAX_PART_BYTES = 48 * 1024;

/**
 * What this device has written since it last collected, as change-sets in `self_outbox` (one, or several parts in
 * order when it is too big for one log entry), or null when nothing was. Answers the first part.
 * Each row goes at its values now: a row made goes whole, a row changed goes with the columns that changed, a row gone
 * goes as a removal.
 */
export function collectSelfChanges(database: Database, deviceId: string): Promise<SelfChangeSet | null> {
  return database.transaction(async (tx) => {
    const pending = await tx.values<[number, string, string, string, number]>(sql`SELECT seq, tbl, pk, cols, at FROM self_pending ORDER BY seq`);
    if (pending.length === 0) return null;
    const madeAt = Math.max(...pending.map((row) => Number(row[4])));
    const rows = new Map<string, { table: string; key: unknown[]; made: boolean; columns: Set<string> }>();
    for (const [, table, pk, cols] of pending) {
      const key = JSON.parse(pk) as unknown[];
      const name = `${table}\u0000${pkText(key)}`;
      const entry = rows.get(name) ?? { table, key, made: false, columns: new Set<string>() };
      if (cols === '*') entry.made = true;
      else if (cols === '-') {
        entry.made = false;
        entry.columns.clear();
      } else for (const column of JSON.parse(cols) as (string | null)[]) if (column) entry.columns.add(column);
      rows.delete(name);
      rows.set(name, entry);
    }
    // Dated when the last of these writes was made, not when they were collected; never behind this device's clock.
    // Each op with what its clocks will say once its part's clock is known; then cut into parts that fit one log entry.
    const planned: { op: SelfOp; size: number; pk: string; columns: string[] }[] = [];
    for (const { table, key, made, columns } of rows.values()) {
      const meta = await tableMeta(tx, table);
      if (!meta) continue;
      // A key of another shape is a row gone before its table's key changed (0127's bill_payments): it goes as a removal.
      const row = key.length === meta.keys.length ? await readRow(tx, meta, key) : null;
      const pk = pkText(key);
      if (!row) {
        // Merged into another row by an apply here: that row carries it now, and the other devices did the same.
        if ((await tx.values(sql`SELECT 1 FROM self_aliases WHERE tbl = ${table} AND from_pk = ${pk}`)).length > 0) continue;
        const op: SelfOp = { t: table, k: key, d: true };
        planned.push({ op, size: JSON.stringify(op).length, pk, columns: [] });
        continue;
      }
      const names = made ? meta.columns.filter((column) => !meta.keys.includes(column)) : meta.columns.filter((column) => columns.has(column));
      if (!made && names.length === 0) continue;
      const op: SelfOp = { t: table, k: key, c: Object.fromEntries(names.map((column) => [column, row[column]])), ...(made ? { i: true as const } : {}) };
      planned.push({ op, size: JSON.stringify(op).length, pk, columns: made ? ['', ...names] : names });
    }
    await tx.run(sql`DELETE FROM self_pending WHERE seq <= ${pending[pending.length - 1]![0]}`);
    if (planned.length === 0) return null;
    const parts: (typeof planned)[] = [[]];
    let size = 0;
    for (const item of planned) {
      if (size + item.size > MAX_PART_BYTES && parts[parts.length - 1]!.length > 0) {
        parts.push([]);
        size = 0;
      }
      parts[parts.length - 1]!.push(item);
      size += item.size;
    }
    const sets: SelfChangeSet[] = [];
    for (const part of parts) {
      // Dated when the last of these writes was made, not when they were collected; never behind this device's clock.
      const hlc = await localTick(tx, deviceId, madeAt);
      for (const { op, pk, columns } of part) {
        if (op.d) {
          await tx.run(sql`DELETE FROM self_clocks WHERE tbl = ${op.t} AND pk = ${pk}`);
          await tx.run(sql`INSERT INTO self_tombstones (tbl, pk, hlc) VALUES (${op.t}, ${pk}, ${hlc}) ON CONFLICT (tbl, pk) DO UPDATE SET hlc = excluded.hlc`);
          continue;
        }
        await setClocks(tx, op.t, pk, columns, hlc);
        if (op.i) await tx.run(sql`DELETE FROM self_tombstones WHERE tbl = ${op.t} AND pk = ${pk}`);
      }
      const changeSet: SelfChangeSet = { v: 1, hlc, schema: LATEST_VERSION, ops: part.map(({ op }) => op) };
      await tx.run(sql`INSERT INTO self_outbox (id, hlc, change_json, created_at) VALUES (${uuidv7()}, ${hlc}, ${JSON.stringify(changeSet)}, ${new Date().toISOString()})`);
      sets.push(changeSet);
    }
    return sets[0]!;
  });
}

/* ------------------------------------------------------------------------------------------------------ apply */

class Hold extends Error {
  constructor(readonly result: SelfApplyResult & { status: 'held' }) {
    super('held');
  }
}

interface Run {
  tx: Tx;
  hlc: string;
  notes: SelfNote[];
  /** Transactions this change-set made, for rule 4. */
  made: string[];
  /**
   * On the seat (Drop 6): what another of the owner's devices changed in a workspace shared with someone else is also
   * captured for the household, as if it had been written here. Off on every other device, and on the retry after a
   * household refusal.
   */
  share: boolean;
}

/** The household entities kept in each table (shared-entities.ts), for capturing what an apply writes (Drop 6). */
const ROW_ENTITIES: ReadonlyMap<string, RowEntity[]> = (() => {
  const out = new Map<string, RowEntity[]>();
  for (const entity of SHARED_ENTITIES) if (entity.kind === 'row') out.set(entity.table, [...(out.get(entity.table) ?? []), entity]);
  return out;
})();

/** The purchase's tables other than `transactions`: a change to one is a change to the purchase it belongs to. */
const PURCHASE_PARTS = new Set(['entries', 'transaction_flags', 'bill_payments', 'book_transactions', 'book_transaction_splits', 'transaction_line_excluded', 'purchase_spreads']);

/** A refusal household sharing gives a write it will not share: the owner's devices keep it, the household does not get it. */
function householdRefusal(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth += 1) {
    if (e instanceof BookReadOnlyError || e instanceof AuthorityError || e instanceof LastOwnerError || e instanceof MemberNameError) return true;
  }
  return false;
}

/** What waits to be sent, oldest first, with each row's id so it is dropped only once the relay has it. */
export async function selfOutbox(database: Database): Promise<{ id: string; changeSet: SelfChangeSet }[]> {
  const rows = await database.db.values<[string, string]>(sql`SELECT id, change_json FROM self_outbox ORDER BY hlc`);
  return rows.map(([rowId, json]) => ({ id: rowId, changeSet: JSON.parse(json) as SelfChangeSet }));
}

export async function dropFromSelfOutbox(database: Database, rowId: string): Promise<void> {
  await database.db.run(sql`DELETE FROM self_outbox WHERE id = ${rowId}`);
}

/** Every change-set this device collected and has not sent, oldest first, taken out of the outbox. */
export function drainSelfOutbox(database: Database): Promise<SelfChangeSet[]> {
  return database.transaction(async (tx) => {
    const rows = await tx.values<[string, string]>(sql`SELECT id, change_json FROM self_outbox ORDER BY hlc`);
    for (const [rowId] of rows) await tx.run(sql`DELETE FROM self_outbox WHERE id = ${rowId}`);
    return rows.map(([, json]) => JSON.parse(json) as SelfChangeSet);
  });
}

/**
 * Applies one change-set from another of the owner's devices, in one transaction: all of it, or (held) none of it.
 * What this device wrote and has not collected is collected first (`deviceId` is this device), so its own edits carry
 * their clocks when the rules compare them.
 */
export async function applySelfChangeSet(database: Database, changeSet: SelfChangeSet, deviceId: string): Promise<SelfApplyResult> {
  if (changeSet.schema > LATEST_VERSION) return { status: 'held', reason: 'newer-version', schema: changeSet.schema };
  await collectSelfChanges(database, deviceId);
  try {
    return await applyOnce(database, changeSet, true);
  } catch (error) {
    if (error instanceof Hold) return error.result;
    // The seat's household sharing is not ready (its engine did not start this time): the change waits, and goes to the
    // household with everything after it once sharing is ready — never applied here without it.
    if (error instanceof SyncNotReadyError || (error as { cause?: unknown })?.cause instanceof SyncNotReadyError) {
      return { status: 'held', reason: 'household-not-ready', schema: changeSet.schema };
    }
    if (!householdRefusal(error)) throw error;
    // The household would not take part of it (a workspace no longer shared, a frozen one, an act only an owner may
    // do): the owner's devices still hold it as it was made, and the household does not get it — said in Activity.
    const result = await applyOnce(database, changeSet, false).catch((again: unknown) => {
      if (again instanceof Hold) return again.result;
      throw again;
    });
    if (result.status === 'applied') {
      await noteNotSharedTx(database, changeSet, error instanceof Error ? error.message : String(error));
      return { ...result, notes: [...result.notes, { kind: 'not-shared', table: '', pk: '' }] };
    }
    return result;
  }
}

async function applyOnce(database: Database, changeSet: SelfChangeSet, share: boolean): Promise<SelfApplyResult> {
  {
    return await database.transaction(async (tx) => {
      await tx.run(sql`INSERT OR REPLACE INTO self_state (key, value) VALUES ('quiet', '1')`);
      await tx.run(sql`PRAGMA defer_foreign_keys = ON`);
      await receiveHlc(tx, changeSet.hlc);
      // Only the seat shares, and only while some workspace here is (or was, now read-only) shared with someone.
      const shares =
        share &&
        !(await seatIsElsewhere(tx)) &&
        (await tx.values(sql`SELECT 1 FROM sqlite_master WHERE name = 'shared_books'`)).length > 0 &&
        (await tx.values(sql`SELECT 1 FROM shared_books WHERE state IN ('active', 'unshared') LIMIT 1`)).length > 0;
      const run: Run = { tx, hlc: changeSet.hlc, notes: [], made: [], share: shares };
      const apply = async () => {
        for (const op of changeSet.ops) for (const one of await opsUnderKeyHere(tx, op, changeSet.hlc)) await applyOp(run, one);
      };
      if (shares) await apply();
      else await withCapturePaused(tx, apply);
      await settleTwiceEdited(run);
      // A bill month paid on two devices before they met keeps one payment, the same on both (bill-settle.ts).
      const paying = changeSet.ops.filter((op) => op.t === 'bill_payments' || op.t === 'transactions').map((op) => String(op.k[0]));
      if (paying.length > 0) await withCapturePaused(tx, () => settleTwicePaidBillsTx(tx, paying));
      for (const note of run.notes) {
        await tx.run(sql`INSERT INTO self_notes (at, kind, tbl, pk, other_pk) VALUES (${new Date().toISOString()}, ${note.kind}, ${note.table}, ${note.pk}, ${note.other ?? null})`);
      }
      await tx.run(sql`DELETE FROM self_state WHERE key = 'quiet'`);
      return { status: 'applied' as const, notes: run.notes };
    });
  }
}

/** Activity's line on every device (written after the apply, so it is sent): a change kept off the household. */
async function noteNotSharedTx(database: Database, changeSet: SelfChangeSet, why: string): Promise<void> {
  const [ws] = await database.db.values<[string]>(sql`SELECT id FROM workspaces ORDER BY created_at LIMIT 1`);
  if (!ws) return;
  await database.db.run(sql`INSERT OR IGNORE INTO audit_log (id, workspace_id, action, entity, entity_id, payload_json, created_at)
    VALUES (${await stableId(changeSet.hlc, 'linked:not-shared')}, ${ws[0]}, 'not_shared', 'linked', ${changeSet.hlc}, ${JSON.stringify({ why })}, ${new Date(decodeHlc(changeSet.hlc).ms).toISOString()})`);
}

/**
 * An op keyed as an older device keys its row, read under this device's key. One table so far: bill_payments, keyed by
 * the transaction alone before 0127 and by the transaction, the bill and the month since. A one-part key there says
 * what the transaction's one bill link is — a removal: none; a row made: that one — so it becomes the removal of each of
 * the transaction's other rows here (each by rule 2's clock test, so a link made here later stays) and, for a row
 * made, that row under its full key. Any other op is applied as it came.
 */
async function opsUnderKeyHere(db: Db, op: SelfOp, hlc: string): Promise<SelfOp[]> {
  if (op.t !== 'bill_payments' || op.k.length !== 1) return [op];
  const meta = await tableMeta(db, op.t);
  if (!meta || meta.keys.length === 1) return [op];
  const transactionId = op.k[0] as string;
  // Rule 2 under the old key too: a link removed here before 0127 (its tombstone keeps the one-part key) comes back
  // only by a fresh insert made after that removal.
  const tomb = await tombstoneOf(db, op.t, pkText(op.k));
  if (!op.d && tomb && !(op.i && later(hlc, tomb))) return [];
  const here = await db.values<[string, string]>(sql`SELECT template_id, bill_month FROM bill_payments WHERE transaction_id = ${transactionId}`);
  const templateId = op.c?.template_id;
  const billMonth = op.c?.bill_month;
  if (!op.d && (typeof templateId !== 'string' || typeof billMonth !== 'string')) {
    // Columns alone, no key: only the transaction's one row here can be the one meant.
    return here.length === 1 ? [{ ...op, k: [transactionId, here[0]![0], here[0]![1]] }] : [];
  }
  const removals: SelfOp[] = here
    .filter(([t, m]) => op.d || t !== templateId || m !== billMonth)
    .map(([t, m]) => ({ t: op.t, k: [transactionId, t, m], d: true as const }));
  return op.d ? removals : [...removals, { ...op, k: [transactionId, templateId, billMonth] }];
}

async function aliasOf(db: Db, table: string, pk: string): Promise<string> {
  let current = pk;
  for (let hops = 0; hops < 8; hops += 1) {
    const [row] = await db.values<[string]>(sql`SELECT to_pk FROM self_aliases WHERE tbl = ${table} AND from_pk = ${current}`);
    if (!row) return current;
    current = row[0];
  }
  return current;
}

/** A merged row's old id, where the op names it: the column then names the row it was merged into. */
async function throughAliases(db: Db, meta: TableMeta, values: Record<string, unknown>): Promise<void> {
  if ((await db.values(sql`SELECT 1 FROM self_aliases LIMIT 1`)).length === 0) return;
  for (const [column, parent] of meta.references) {
    const value = values[column];
    if (typeof value !== 'string') continue;
    const target = await aliasOf(db, parent, pkText([value]));
    if (target !== pkText([value])) values[column] = (JSON.parse(target) as unknown[])[0];
  }
}

/** The children a merge moves (clashes.ts), by table: the column naming the parent, and the parent's table. */
const MERGE_CHILDREN: ReadonlyMap<string, readonly { column: string; parent: string }[]> = (() => {
  const out = new Map<string, { column: string; parent: string }[]>();
  for (const [name, rule] of Object.entries(CLASH_RULES)) {
    if (rule.answer !== 'merge') continue;
    const parent = name.slice(0, name.indexOf(':'));
    for (const [table, column] of rule.children ?? []) out.set(table, [...(out.get(table) ?? []), { column, parent }]);
  }
  return out;
})();

async function parentAlias(db: Db, parent: string, value: unknown): Promise<unknown> {
  if (typeof value !== 'string') return value;
  const target = await aliasOf(db, parent, pkText([value]));
  return target === pkText([value]) ? value : (JSON.parse(target) as unknown[])[0];
}

/**
 * On the seat, an op whose table holds household entities is applied inside household capture, as the write would be
 * had it been made here: an entity row's before and after (`withCapture`), a purchase's lineage (the ledger's doors).
 */
async function applyOp(run: Run, op: SelfOp): Promise<void> {
  if (!run.share) return applyOpNow(run, op);
  const key = (columns: readonly string[], row: Record<string, unknown> | null) => (row ? columns.map((c) => String(row[c] ?? '')).join(OP_ID_SEPARATOR) : undefined);
  const meta = await tableMeta(run.tx, op.t);
  if (!meta) return applyOpNow(run, op);
  const pk = JSON.parse(await aliasOf(run.tx, op.t, pkText(op.k))) as unknown[];
  const before = await readRow(run.tx, meta, pk);
  if (op.t === 'transactions') {
    const id = String(pk[0]);
    if (before && op.c?.status === 'void' && before.status === 'posted') await captureVoidingTx(run.tx, id);
    await applyOpNow(run, op);
    const after = await readRow(run.tx, meta, pk);
    if (after && !before && after.status === 'posted') await capturePostedTx(run.tx, id, null, (after.replaces_transaction_id as string | null) ?? null);
    else if (after && before) await captureCardChangingTx(run.tx, id);
    return;
  }
  if (PURCHASE_PARTS.has(op.t)) {
    await applyOpNow(run, op);
    const row = (await readRow(run.tx, meta, pk)) ?? before;
    const transactionId = row?.transaction_id;
    if (typeof transactionId === 'string') await captureCardChangingTx(run.tx, transactionId);
    return;
  }
  const entities = ROW_ENTITIES.get(op.t);
  if (!entities) return applyOpNow(run, op);
  const merged = { ...(before ?? {}), ...(op.c ?? {}), ...Object.fromEntries(meta.keys.map((k, i) => [k, pk[i]])) };
  const targets = entities.map((entity) => ({ entity: entity.entity, id: key(entity.keyColumns, merged) }));
  await withCapture(run.tx, targets, () => applyOpNow(run, op));
}

async function applyOpNow(run: Run, op: SelfOp): Promise<void> {
  const kind = SELF_TABLES[op.t];
  if (kind !== 'replicate' && kind !== 'seat') return; // never a device's own table
  const meta = await tableMeta(run.tx, op.t);
  if (!meta) return; // a table an older build had and this one dropped
  const sent = [...op.k];
  // A child keyed by a merged parent (a budget's frequency is keyed by its budget) lands on the row it went into.
  for (const { column, parent } of MERGE_CHILDREN.get(op.t) ?? []) {
    const at = meta.keys.indexOf(column);
    if (at >= 0) sent[at] = await parentAlias(run.tx, parent, sent[at]);
  }
  const pk = await aliasOf(run.tx, op.t, pkText(sent));
  const key = JSON.parse(pk) as unknown[];
  if (op.d) {
    // A row merged into another went into it: its removal is not the other row's.
    if (pk !== pkText(op.k)) return;
    return applyRemoval(run, meta, key, pk);
  }

  const values: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(op.c ?? {})) if (meta.columns.includes(column) && !meta.keys.includes(column)) values[column] = value;
  await throughAliases(run.tx, meta, values);
  for (const { column, parent } of MERGE_CHILDREN.get(op.t) ?? []) if (column in values) values[column] = await parentAlias(run.tx, parent, values[column]);
  const row = await readRow(run.tx, meta, key);
  if (!row) {
    const tomb = await tombstoneOf(run.tx, op.t, pk);
    if (tomb && !(op.i && later(run.hlc, tomb))) return; // rule 2
    if (!op.i) {
      run.notes.push({ kind: 'missing-row', table: op.t, pk });
      return;
    }
    const full = { ...values, ...Object.fromEntries(meta.keys.map((k, i) => [k, key[i]])) };
    const clocks = new Map([['', run.hlc], ...Object.keys(values).map((column) => [column, run.hlc] as const)]);
    if (await placeRow(run, meta, key, full, clocks)) {
      await run.tx.run(sql`DELETE FROM self_tombstones WHERE tbl = ${op.t} AND pk = ${pk}`);
      if (op.t === 'transactions') run.made.push(String(key[0]));
    }
    return;
  }
  const clocks = await clocksOf(run.tx, op.t, pk);
  const winners: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(values)) {
    if (op.t === 'transactions' && column === 'status') {
      // Rule 3: void stays void, and a void always wins.
      if (row.status === 'void') continue;
      if (value === 'void' || later(run.hlc, clocks.get(column))) winners[column] = value;
      continue;
    }
    if (later(run.hlc, clocks.get(column))) winners[column] = value;
  }
  if (Object.keys(winners).length > 0) {
    await guarded(run, meta, key, { ...row, ...winners }, () => run.tx.run(sql`UPDATE ${id(op.t)} SET ${sql.join(Object.entries(winners).map(([c, v]) => sql`${id(c)} = ${v as string}`), sql`, `)} WHERE ${whereKey(meta, key)}`));
    await setClocks(run.tx, op.t, pk, Object.keys(winners), run.hlc);
  }
  if (op.i) await setClocks(run.tx, op.t, pk, [''], run.hlc);
}

async function applyRemoval(run: Run, meta: TableMeta, key: unknown[], pk: string): Promise<void> {
  const clocks = await clocksOf(run.tx, meta.table, pk);
  // Rule 2, the other way round: a row made again here after this removal was decided stays.
  if (!later(run.hlc, clocks.get(''))) return;
  await run.tx.run(sql`DELETE FROM ${id(meta.table)} WHERE ${whereKey(meta, key)}`);
  await run.tx.run(sql`DELETE FROM self_clocks WHERE tbl = ${meta.table} AND pk = ${pk}`);
  await run.tx.run(sql`INSERT INTO self_tombstones (tbl, pk, hlc) VALUES (${meta.table}, ${pk}, ${run.hlc})
    ON CONFLICT (tbl, pk) DO UPDATE SET hlc = CASE WHEN excluded.hlc > self_tombstones.hlc THEN excluded.hlc ELSE self_tombstones.hlc END`);
}

/* ------------------------------------------------------------------------------------------------------ rule 5 */

/** Runs a write; a unique-key clash it meets is answered by that key's rule (and, for `hold`, the whole set waits). */
async function guarded(run: Run, meta: TableMeta, key: unknown[], wouldBe: Record<string, unknown>, write: () => Promise<unknown>): Promise<void> {
  await run.tx.run(sql`SAVEPOINT self_write`);
  try {
    await write();
    await run.tx.run(sql`RELEASE self_write`);
  } catch (error) {
    await run.tx.run(sql`ROLLBACK TO self_write`);
    await run.tx.run(sql`RELEASE self_write`);
    if (!isUniqueFailure(error)) throw error;
    const clash = await findClash(run.tx, meta, key, wouldBe);
    if (!clash) throw error;
    // An edit that moves an existing row onto another's key: rare, and never settled by itself.
    throw new Hold({ status: 'held', reason: 'clash', key: clash.key.id, table: meta.table, pk: pkText(key), other: pkText(clash.other), why: whyOf(clash.rule) });
  }
}

const whyOf = (rule: ClashRule) => (rule.answer === 'hold' ? rule.why : `an edit moved a row onto another's ${rule.answer === 'merge' ? 'key' : 'mark'}`);

/** The row here that `wouldBe` clashes with, and the key it clashes on. */
async function findClash(db: Db, meta: TableMeta, key: unknown[], wouldBe: Record<string, unknown>): Promise<{ key: UniqueKey; rule: ClashRule; other: unknown[] } | null> {
  for (const unique of meta.unique) {
    if (unique.columns.some((column) => wouldBe[column] === null || wouldBe[column] === undefined)) continue;
    const where = unique.where ? sql.raw(`(${unique.where})`) : sql`1`;
    if (unique.where) {
      const probe = sql.join(meta.columns.map((column) => sql`${(wouldBe[column] ?? null) as string} AS ${id(column)}`), sql`, `);
      if ((await db.values(sql`SELECT 1 FROM (SELECT ${probe}) WHERE ${where}`)).length === 0) continue;
    }
    const same = sql.join(unique.columns.map((column) => sql`${id(column)} = ${wouldBe[column] as string}`), sql` AND `);
    const [other] = await db.values<unknown[]>(sql`SELECT ${sql.join(meta.keys.map(id), sql`, `)} FROM ${id(meta.table)} WHERE ${same} AND ${where} AND NOT (${whereKey(meta, key)})`);
    if (!other) continue;
    const rule = CLASH_RULES[unique.id] ?? { answer: 'hold' as const, why: 'a unique key with no rule' };
    return { key: unique, rule, other };
  }
  return null;
}

/**
 * Puts a row this device does not hold, under `key`, at the clocks given (`''` when it was made). On a unique-key
 * clash with a row here, the key's rule decides; the later of the two is the one whose key columns' clock is later
 * (ties by id), the same answer on every device. Answers whether the row now stands under `key`.
 */
async function placeRow(run: Run, meta: TableMeta, key: unknown[], values: Record<string, unknown>, clocks: Map<string, string>): Promise<boolean> {
  const pk = pkText(key);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await run.tx.run(sql`SAVEPOINT self_place`);
    try {
      const columns = Object.keys(values);
      await run.tx.run(sql`INSERT INTO ${id(meta.table)} (${sql.join(columns.map(id), sql`, `)}) VALUES (${sql.join(columns.map((c) => sql`${values[c] as string}`), sql`, `)})`);
      await run.tx.run(sql`RELEASE self_place`);
      for (const [column, hlc] of clocks) await setClocks(run.tx, meta.table, pk, [column], hlc);
      return true;
    } catch (error) {
      await run.tx.run(sql`ROLLBACK TO self_place`);
      await run.tx.run(sql`RELEASE self_place`);
      if (!isUniqueFailure(error)) throw error;
      const clash = await findClash(run.tx, meta, key, values);
      if (!clash) throw error;
      const otherPk = pkText(clash.other);
      if (clash.rule.answer === 'hold') {
        throw new Hold({ status: 'held', reason: 'clash', key: clash.key.id, table: meta.table, pk, other: otherPk, why: clash.rule.why });
      }
      const theirs = await clocksOf(run.tx, meta.table, otherPk);
      const mineAt = maxClock(clocks, clash.key.columns);
      const theirsAt = maxClock(theirs, clash.key.columns);
      const incomingLater = compareHlc(mineAt, theirsAt) > 0 || (mineAt === theirsAt && pk > otherPk);
      if (clash.rule.answer === 'keep-both') {
        run.notes.push({ kind: 'maybe-duplicate', table: meta.table, pk, other: otherPk });
        const column = clash.rule.clear;
        // Dated by the later row, never by this apply's own clock: every device clears the same row at the same clock.
        const laterAt = (incomingLater ? mineAt : theirsAt) || run.hlc;
        if (incomingLater) {
          values[column] = null;
          clocks.set(column, laterAt);
        } else {
          await run.tx.run(sql`UPDATE ${id(meta.table)} SET ${id(column)} = NULL WHERE ${whereKey(meta, clash.other)}`);
          await setClocks(run.tx, meta.table, otherPk, [column], laterAt);
        }
        const workspace = incomingLater ? values.workspace_id : (await readRow(run.tx, meta, clash.other))?.workspace_id;
        await noteDuplicateTx(run.tx, meta.table, incomingLater ? key[0] : clash.other[0], incomingLater ? clash.other[0] : key[0], workspace, laterAt);
        continue;
      }
      // Merge: the earlier row stays, each column the later value of the two, the other's children moved onto it.
      run.notes.push({ kind: 'merged', table: meta.table, pk, other: otherPk });
      const other = (await readRow(run.tx, meta, clash.other))!;
      const loose = meta.columns.filter((column) => !meta.keys.includes(column) && !clash.key.columns.includes(column));
      if (incomingLater) {
        // The row here stays; the incoming one's later columns go onto it.
        const winners = loose.filter((column) => column in values && later(clocks.get(column), theirs.get(column)));
        if (winners.length > 0) {
          await run.tx.run(sql`UPDATE ${id(meta.table)} SET ${sql.join(winners.map((c) => sql`${id(c)} = ${values[c] as string}`), sql`, `)} WHERE ${whereKey(meta, clash.other)}`);
          for (const column of winners) await setClocks(run.tx, meta.table, otherPk, [column], clocks.get(column)!);
        }
        await run.tx.run(sql`INSERT OR REPLACE INTO self_aliases (tbl, from_pk, to_pk) VALUES (${meta.table}, ${pk}, ${otherPk})`);
        return false;
      }
      // The incoming row is the earlier: it stays, the row here goes into it.
      for (const column of loose) {
        if (later(theirs.get(column), clocks.get(column))) {
          values[column] = other[column];
          clocks.set(column, theirs.get(column)!);
        }
      }
      await run.tx.run(sql`DELETE FROM ${id(meta.table)} WHERE ${whereKey(meta, clash.other)}`);
      await run.tx.run(sql`DELETE FROM self_clocks WHERE tbl = ${meta.table} AND pk = ${otherPk}`);
      await run.tx.run(sql`INSERT OR REPLACE INTO self_aliases (tbl, from_pk, to_pk) VALUES (${meta.table}, ${otherPk}, ${pk})`);
      await run.tx.run(sql`UPDATE self_aliases SET to_pk = ${pk} WHERE tbl = ${meta.table} AND to_pk = ${otherPk}`);
      const placed = await placeRow(run, meta, key, values, clocks);
      for (const [childTable, column] of clash.rule.children ?? []) await moveChildren(run, childTable, column, clash.other[0], key[0]);
      return placed;
    }
  }
  throw new Error(`A row of ${meta.table} kept meeting a clash`);
}

/**
 * Rule 5's "keep both", said where the owner looks (Settings › Activity, `activity.ts`): the later row may be the same
 * purchase or draft recorded twice. One line, named by the later row and dated by its clock, so every device that
 * settles the clash writes the same line; nothing is sent.
 */
async function noteDuplicateTx(db: Db, table: string, laterId: unknown, earlierId: unknown, workspaceId: unknown, laterAt: string): Promise<void> {
  if (typeof laterId !== 'string' || typeof workspaceId !== 'string') return;
  const at = new Date(decodeHlc(laterAt).ms).toISOString();
  const payload = JSON.stringify({ table, other: earlierId });
  await db.run(sql`INSERT OR IGNORE INTO audit_log (id, workspace_id, action, entity, entity_id, payload_json, created_at)
    VALUES (${await stableId(laterId, 'linked:maybe-duplicate')}, ${workspaceId}, 'maybe_duplicate', 'linked', ${laterId}, ${payload}, ${at})`);
}

/** A merged row's children, moved onto the row it went into. Each lands as a row of its own, by the same rules. */
async function moveChildren(run: Run, table: string, column: string, from: unknown, to: unknown): Promise<void> {
  const meta = await tableMeta(run.tx, table);
  if (!meta) return;
  const children = await run.tx.values<unknown[]>(sql`SELECT ${sql.join(meta.keys.map(id), sql`, `)} FROM ${id(table)} WHERE ${id(column)} = ${from as string}`);
  for (const childKey of children) {
    const oldPk = pkText(childKey);
    const row = (await readRow(run.tx, meta, childKey))!;
    const clocks = await clocksOf(run.tx, table, oldPk);
    await run.tx.run(sql`DELETE FROM ${id(table)} WHERE ${whereKey(meta, childKey)}`);
    await run.tx.run(sql`DELETE FROM self_clocks WHERE tbl = ${table} AND pk = ${oldPk}`);
    const moved = { ...row, [column]: to };
    const newKey = meta.keys.map((k) => moved[k]);
    const newPk = pkText(newKey);
    if (newPk !== oldPk) await run.tx.run(sql`INSERT OR REPLACE INTO self_aliases (tbl, from_pk, to_pk) VALUES (${table}, ${oldPk}, ${newPk})`);
    const there = await readRow(run.tx, meta, newKey);
    if (!there) {
      await placeRow(run, meta, newKey, moved, clocks);
      continue;
    }
    // The row it went into has one under the same key already: one row, each column the later value.
    const theirs = await clocksOf(run.tx, table, newPk);
    const winners = meta.columns.filter((c) => !meta.keys.includes(c) && later(clocks.get(c), theirs.get(c)));
    if (winners.length > 0) {
      await run.tx.run(sql`UPDATE ${id(table)} SET ${sql.join(winners.map((c) => sql`${id(c)} = ${moved[c] as string}`), sql`, `)} WHERE ${whereKey(meta, newKey)}`);
      for (const c of winners) await setClocks(run.tx, table, newPk, [c], clocks.get(c)!);
    }
  }
}

/* ------------------------------------------------------------------------------------------------------ rule 4 */

/**
 * One transaction edited on two devices apart leaves two posted rows replacing it. The one made later stays; the other,
 * and whatever replaced it since, is voided — on every device alike, never sent. A void the ledger refuses (an
 * event's own posting, a sale) leaves both, noted.
 */
async function settleTwiceEdited(run: Run): Promise<void> {
  for (const madeId of run.made) {
    const [row] = await run.tx.values<[string | null, string]>(sql`SELECT replaces_transaction_id, status FROM transactions WHERE id = ${madeId}`);
    if (!row || !row[0] || row[1] !== 'posted') continue;
    const siblings = (await run.tx.values<[string]>(sql`SELECT id FROM transactions WHERE replaces_transaction_id = ${row[0]} AND status = 'posted'`)).map(([s]) => s);
    if (siblings.length < 2) continue;
    const madeAt = new Map<string, string>();
    for (const sibling of siblings) madeAt.set(sibling, (await clocksOf(run.tx, 'transactions', pkText([sibling]))).get('') ?? '');
    const keep = siblings.reduce((a, b) => (compareHlc(madeAt.get(b)!, madeAt.get(a)!) > 0 || (madeAt.get(b) === madeAt.get(a) && b > a) ? b : a));
    for (const loser of siblings.filter((s) => s !== keep)) {
      const chain = [loser];
      for (let i = 0; i < chain.length; i += 1) {
        for (const [next] of await run.tx.values<[string]>(sql`SELECT id FROM transactions WHERE replaces_transaction_id = ${chain[i]!} AND status = 'posted'`)) chain.push(next);
      }
      await run.tx.run(sql`SAVEPOINT self_fork`);
      try {
        for (const victim of chain.reverse()) {
          const [ws] = await run.tx.values<[string, string]>(sql`SELECT w.id, w.base_currency FROM transactions t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${victim}`);
          const [status] = await run.tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${victim}`);
          if (status?.[0] === 'posted') await voidTransactionTx(run.tx, { workspaceId: ws![0], baseCurrency: ws![1] }, victim);
          // Its void line, dated by the edit that won rather than by this device's clock: every device writes it alike.
          const at = new Date(decodeHlc(madeAt.get(keep)! || run.hlc).ms).toISOString();
          await run.tx.run(sql`UPDATE audit_log SET created_at = ${at} WHERE id = ${await stableId(victim, 'audit:void')}`);
        }
        await run.tx.run(sql`RELEASE self_fork`);
        run.notes.push({ kind: 'edited-twice', table: 'transactions', pk: pkText([keep]), other: pkText([loser]) });
      } catch {
        await run.tx.run(sql`ROLLBACK TO self_fork`);
        await run.tx.run(sql`RELEASE self_fork`);
        run.notes.push({ kind: 'edited-twice-kept-both', table: 'transactions', pk: pkText([keep]), other: pkText([loser]) });
      }
    }
  }
}
