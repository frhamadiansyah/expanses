import { decodeHlc } from '../../src/sync/hlc';
import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { Database, Db } from '../../src/database';
import type { ChangeLogEntry } from '../../src/sync/seal';
import { bookSplitsExist, filedInBook } from '../../src/repos/book-splits';
import { exactForTransactionTx } from '../../src/repos/exact-column';
import { viewMember } from '../../src/sync/authority';
import { configureCapture, localDeviceId, paidFromOf, planSpreadWaitsTx, projectPurchase, thirdMarksCrossedKey, thirdMarkWaitsTx } from '../../src/sync/capture';
import { parseOpId, SHARED_ENTITIES, type PurchaseEntity, type RowEntity } from '../../src/sync/shared-entities';
import type { ChangeSet, Op } from '../../src/sync/types';

/*
 * §6.4 "Nothing escapes capture", test harness only. `installCaptureTriggers` puts TEMP triggers on every table
 * `SHARED_ENTITIES` names — AFTER INSERT, AFTER UPDATE OF the synced columns (and only when one of them really
 * changed), and BEFORE DELETE — each writing `(table, key, op)` to the temp table `__writes`. A row entity's triggers
 * fire only for a row in the shared book; a purchase table's fire for every row, and `uncapturedWrites` keeps those
 * whose transaction is filed in the shared book.
 *
 * `uncapturedWrites` then names every recorded write that no op in `sync_outbox` accounts for. The capture run
 * (`npm run test:capture`, vitest.capture.config.ts) seeds one shared book in every workspace the suite creates and
 * fails any test that leaves such a write behind: the existing suite is the completeness test, and no repository
 * function is called by hand.
 *
 * TEMP objects are per connection and never serialised, so an export carries none of this, and a restore
 * (`importBytes`, a new connection) quietly ends the watch.
 */

const dialect = new SQLiteSyncDialect();

/** Renders a drizzle SQL fragment with its parameters inlined, for trigger DDL (test code, trusted values only). */
function inline(fragment: SQL): string {
  const { sql: text, params } = dialect.sqlToQuery(fragment);
  let i = 0;
  return text.replace(/\?/g, () => {
    const value = params[i++];
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

const keyExpr = (row: 'NEW' | 'OLD', columns: readonly string[]) => columns.map((c) => `${row}.${c}`).join(` || '|' || `);
const changed = (columns: readonly string[]) => columns.map((c) => `OLD.${c} IS NOT NEW.${c}`).join(' OR ');
/**
 * The high-water mark of sealed change-sets when the write happened: only ops sealed after it can account for the
 * write. Counted in `temp.__sealed`, which copies every change-set as it enters `sync_outbox` — so one the engine has
 * since drained to the relay still accounts for its writes, and a drained outbox reusing rowids cannot move the mark.
 */
const MARK = `(SELECT coalesce(max(seq), 0) FROM temp.__sealed)`;
const jsonOf = (row: 'OLD' | 'NEW', columns: readonly string[]) => `json_object(${columns.map((c) => `'${c}', ${row}.${c}`).join(', ')})`;
const changedNames = (columns: readonly string[]) => columns.map((c) => `CASE WHEN OLD.${c} IS NOT NEW.${c} THEN '${c},' ELSE '' END`).join(' || ');

/**
 * The columns each watched table had when its triggers went in, per database: one stopped at an older version (a
 * migration test) has not got every synced column yet (0091's currency, say), and its triggers and checks name only
 * those it has. A later script that alters a watched table (a migrate() on the handle, a test dropping a column to
 * stand for an older build) has that table's triggers and columns made again (`afterSchemaChange`).
 */
const presentColumns = new WeakMap<Database, Map<string, ReadonlySet<string>>>();

/** A row entity's synced columns: its key, its fields, and the columns its derived fields stand for, as far as the table has them. */
function syncedColumns(entity: RowEntity, present?: ReadonlySet<string>): string[] {
  const all = [...new Set([...entity.keyColumns, ...Object.values(entity.fields), ...Object.values(entity.derivedFields ?? {}).flat()])];
  return present ? all.filter((column) => present.has(column)) : all;
}

/**
 * Every trigger's first condition: the book is shared right now, and the write is not apply's. A write to a book that
 * is not (yet) shared needs no op (§6.3: "a write outside a shared book emits nothing"); a write made inside
 * `withCapturePaused` is apply writing what another device already emitted, and the capture config's `pausedWrites`
 * observer (capture-setup.ts) marks exactly those with a row in `temp.__apply_paused`.
 */
const watching = (bookId: string) =>
  `NOT EXISTS (SELECT 1 FROM temp.__apply_paused) AND EXISTS (SELECT 1 FROM main.shared_books WHERE book_id = '${bookId.replace(/'/g, "''")}' AND state = 'active')`;

function rowEntityDdl(entity: RowEntity, bookId: string, present?: ReadonlySet<string>): string {
  const inBook = (row: 'NEW' | 'OLD') =>
    `${watching(bookId)} AND EXISTS (SELECT 1 FROM ${entity.table} t WHERE t.rowid = ${row}.rowid AND ${inline(entity.scope(bookId))})`;
  const synced = syncedColumns(entity, present);
  // `old` is the row as it stood before this write (NULL for an insert): the check compares the first write's `old`
  // with the row as it ends, so a row deleted and written back as it was is no change at all.
  const record = (row: 'NEW' | 'OLD', op: string, old: string) =>
    `INSERT INTO __writes (tbl, key, op, cols, old, mark) VALUES ('${entity.table}', ${keyExpr(row, entity.keyColumns)}, '${op}', '*', ${old}, ${MARK});`;
  const name = `__capture_${entity.table}`;
  return `
    CREATE TEMP TRIGGER IF NOT EXISTS ${name}_ins AFTER INSERT ON main.${entity.table} WHEN ${inBook('NEW')}
    BEGIN ${record('NEW', 'insert', 'NULL')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name}_upd AFTER UPDATE OF ${synced.join(', ')} ON main.${entity.table}
    WHEN (${changed(synced)}) AND ${inBook('NEW')}
    BEGIN ${record('NEW', 'update', jsonOf('OLD', synced))} END;
    -- BEFORE, not AFTER: the scope test reads the row itself, which an AFTER DELETE trigger can no longer see.
    CREATE TEMP TRIGGER IF NOT EXISTS ${name}_del BEFORE DELETE ON main.${entity.table} WHEN ${inBook('OLD')}
    BEGIN ${record('OLD', 'delete', jsonOf('OLD', synced))} END;`;
}

/** Per purchase table: the column naming its transaction, and each synced column with the purchase field it feeds. */
function purchaseTables(entity: PurchaseEntity): Map<string, { txColumn: string; fieldOf: Map<string, string> }> {
  const out = new Map<string, { txColumn: string; fieldOf: Map<string, string> }>();
  for (const table of entity.tables) out.set(table, { txColumn: table === 'transactions' ? 'id' : 'transaction_id', fieldOf: new Map() });
  for (const [field, columns] of Object.entries(entity.fields)) {
    for (const qualified of columns) {
      const [table, column] = qualified.split('.') as [string, string];
      out.get(table)!.fieldOf.set(column, field);
    }
  }
  // Moving a row between books is a synced fact too: it is judged by the lineage's head, not by a field. So is filing a
  // purchase split across workspaces (0084).
  out.get('book_transactions')!.fieldOf.set('book_id', '');
  out.get('book_transaction_splits')?.fieldOf.set('book_id', '');
  return out;
}

function purchaseDdl(entity: PurchaseEntity, bookId: string, columnsOf: ReadonlyMap<string, ReadonlySet<string>>): string {
  const parts: string[] = [];
  const when = watching(bookId);
  for (const [table, { txColumn, fieldOf }] of purchaseTables(entity)) {
    // A database stopped at an older version has not got every purchase table yet (0084's splits, say).
    if (!columnsOf.has(table)) continue;
    const record = (row: 'NEW' | 'OLD', op: string, cols: string) =>
      `INSERT INTO __writes (tbl, key, op, cols, old, mark) VALUES ('${table}', ${row}.${txColumn}, '${op}', ${cols}, NULL, ${MARK});`;
    const name = `__capture_${table}`;
    parts.push(`CREATE TEMP TRIGGER IF NOT EXISTS ${name}_ins AFTER INSERT ON main.${table} WHEN ${when} BEGIN ${record('NEW', 'insert', "'*'")} END;`);
    // A database stopped at an older version has not got every synced column yet (0067's day_order, say).
    const columns = [...fieldOf.keys()].filter((column) => columnsOf.get(table)?.has(column) ?? true);
    if (columns.length) {
      parts.push(
        `CREATE TEMP TRIGGER IF NOT EXISTS ${name}_upd AFTER UPDATE OF ${columns.join(', ')} ON main.${table} WHEN ${when} AND (${changed(columns)}) BEGIN ${record('NEW', 'update', changedNames(columns))} END;`,
      );
    }
    parts.push(`CREATE TEMP TRIGGER IF NOT EXISTS ${name}_del AFTER DELETE ON main.${table} WHEN ${when} BEGIN ${record('OLD', 'delete', "'*'")} END;`);
  }
  return parts.join('\n');
}

/** Installs §6.4's triggers for one shared book. Idempotent. */
export async function installCaptureTriggers(database: Database, bookId: string): Promise<void> {
  const ddl = [
    `CREATE TEMP TABLE IF NOT EXISTS __writes (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, key TEXT NOT NULL, op TEXT NOT NULL, cols TEXT NOT NULL, old TEXT, mark INTEGER NOT NULL);`,
    `CREATE TEMP TABLE IF NOT EXISTS __apply_paused (x INTEGER);`,
    `CREATE TEMP TABLE IF NOT EXISTS __sealed (seq INTEGER PRIMARY KEY, book_id TEXT NOT NULL, entry_json TEXT, change_json TEXT);`,
    `CREATE TEMP TRIGGER IF NOT EXISTS __capture_sealed AFTER INSERT ON main.sync_outbox BEGIN INSERT INTO __sealed (book_id, entry_json) VALUES (NEW.book_id, NEW.entry_json); END;`,
    // Every lineage id this database ever held: a purchase's id is the lineage's on the wire, even after a fixture (or
    // a leave) takes the lineage rows away (G4).
    `CREATE TEMP TABLE IF NOT EXISTS __lineages_seen (lineage_id TEXT PRIMARY KEY);`,
    `CREATE TEMP TRIGGER IF NOT EXISTS __capture_lineage_seen AFTER INSERT ON main.sync_lineage BEGIN INSERT OR IGNORE INTO __lineages_seen (lineage_id) VALUES (NEW.lineage_id); END;`,
    `CREATE TEMP TABLE IF NOT EXISTS __transfers_seen (transfer_id TEXT PRIMARY KEY);`,
  ];
  // A test that stops its database at an older version (a migration test) has no table yet for a later entity.
  const tables = new Set((await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(([name]) => name));
  if (tables.has('shared_transfers')) {
    ddl.push(
      `CREATE TEMP TRIGGER IF NOT EXISTS __capture_transfer_seen AFTER INSERT ON main.shared_transfers BEGIN INSERT OR IGNORE INTO __transfers_seen (transfer_id) VALUES (NEW.transfer_id); END;`,
    );
  }
  const columnsOf = new Map<string, Set<string>>();
  for (const entity of SHARED_ENTITIES) {
    if (entity.kind !== 'purchase') continue;
    for (const table of entity.tables) {
      if (!tables.has(table)) continue;
      columnsOf.set(table, new Set((await database.db.values<[string]>(sql`SELECT name FROM pragma_table_info(${table})`)).map(([name]) => name)));
    }
  }
  const present = presentColumns.get(database) ?? new Map<string, ReadonlySet<string>>();
  presentColumns.set(database, present);
  for (const entity of SHARED_ENTITIES) {
    if (entity.kind !== 'row') {
      ddl.push(purchaseDdl(entity, bookId, columnsOf));
      continue;
    }
    if (!tables.has(entity.table)) continue;
    // The goal entities are scoped by goal_shares (0109): on a database stopped before it, a trigger naming it would
    // fail every write to goals, and no goal can be shared there anyway.
    if (entity.table.startsWith('goal') && !tables.has('goal_shares')) continue;
    if (!present.has(entity.table)) present.set(entity.table, new Set((await database.db.values<[string]>(sql`SELECT name FROM pragma_table_info(${entity.table})`)).map(([name]) => name)));
    ddl.push(rowEntityDdl(entity, bookId, present.get(entity.table)));
  }
  await database.execScript(ddl.join('\n'));
}

/**
 * A test that changes a watched table's columns under the watch (an older build simulated by dropping a column, its
 * update by adding it back): SQLite refuses to drop or rename a column a trigger names, so the table's triggers go
 * first (`beforeSchemaChange`), and once the script has run they are made again from the columns the table has now
 * (`afterSchemaChange`) — the watch goes on, as narrow or as wide as the table. Returns the tables the script alters.
 */
export async function beforeSchemaChange(database: Database, script: string): Promise<string[]> {
  const altered = [...script.matchAll(/ALTER\s+TABLE\s+(?:main\.)?["`]?(\w+)["`]?\s+(DROP|RENAME|ADD)\b/gi)];
  const narrowed = [...new Set(altered.filter((m) => m[2]!.toUpperCase() !== 'ADD').map((m) => m[1]!))];
  if (narrowed.length) {
    await database.execScript(narrowed.flatMap((t) => ['ins', 'upd', 'del'].map((k) => `DROP TRIGGER IF EXISTS temp.__capture_${t}_${k};`)).join('\n'));
  }
  // A table rebuilt under its name (`ALTER TABLE x_new RENAME TO x`, as migrations change a CHECK) is a table altered too.
  const renamedTo = [...script.matchAll(/RENAME\s+TO\s+["`]?(\w+)["`]?/gi)].map((m) => m[1]!);
  return [...new Set([...altered.map((m) => m[1]!), ...renamedTo])];
}

export async function afterSchemaChange(database: Database, bookId: string, tables: readonly string[]): Promise<void> {
  if (tables.length === 0) return;
  const present = presentColumns.get(database);
  for (const t of tables) present?.delete(t);
  await database.execScript(tables.flatMap((t) => ['ins', 'upd', 'del'].map((k) => `DROP TRIGGER IF EXISTS temp.__capture_${t}_${k};`)).join('\n'));
  await installCaptureTriggers(database, bookId);
}

interface SealedOp {
  rowid: number;
  hlc: string;
  op: Op;
}

/** The `temp.__sealed` book of a change-set apply took in: never a book id, so `privateLeaks` passes it over. */
const appliedIn = (bookId: string | undefined) => `applied:${bookId ?? ''}`;

/**
 * Every op this device's peers will end up with since the watch began, by `entity\0id`, each with the seq it was
 * recorded at and its hlc, latest hlc last: every change-set sealed here (drained or not), and every change-set apply
 * took in from another device (`recordApplied`), because what a field ends as is the latest hlc that carried it,
 * whoever wrote it (§7.3 rule 1).
 */
async function outboxOps(database: Database, watchedBookId: string): Promise<Map<string, SealedOp[]>> {
  const rows = await database.db.values<[number, string, string | null, string | null]>(sql`SELECT seq, book_id, entry_json, change_json FROM temp.__sealed ORDER BY seq`);
  const out = new Map<string, SealedOp[]>();
  for (const [rowid, bookId, entryJson, changeJson] of rows) {
    // Another shared book's outbox (a net-worth group log beside the workspace, joint-net-worth §4) accounts for none of
    // the watched book's writes: its member and device rows share their keys with the workspace's. Nor does what apply
    // took in to another book. Apply's rows of an unnamed book ('applied:') are kept.
    if (!(bookId === watchedBookId || bookId === appliedIn(watchedBookId) || bookId === appliedIn(undefined))) continue;
    // The outbox keeps plaintext change-sets (sealed only at drain), and apply records the one it takes in.
    const changeSet = JSON.parse((changeJson ?? entryJson)!) as ChangeSet;
    for (const op of changeSet.ops) {
      const key = `${op.entity}\u0000${op.id}`;
      out.set(key, [...(out.get(key) ?? []), { rowid: Number(rowid), hlc: changeSet.hlc, op }]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.rowid - b.rowid));
  return out;
}

/**
 * Tells capture to mark apply's writes (`withCapturePaused`) so the triggers leave them out, and to record the
 * change-set each apply takes in from another device among the ops a later local write is judged against.
 */
export function watchPausedWrites(database: Database): void {
  // A database whose rows were swapped under it (a restore into the same handle, `importBytes`) has a new connection
  // with no temp tables: the watch is gone there (G8), and apply's writes are simply not marked.
  const watching = async (tx: Db) => (await tx.values(sql`SELECT 1 FROM temp.sqlite_master WHERE name = '__apply_paused'`)).length > 0;
  configureCapture(database, {
    pausedWrites: {
      // Kept under the book it was applied in, as an applied row ('applied:' + book): a net-worth group log's member
      // rows share their keys with the workspace's, and account for none of the workspace's writes.
      begin: async (tx: Db, changeSet?: ChangeSet, bookId?: string) => {
        if (!(await watching(tx))) return;
        await tx.run(sql`INSERT INTO temp.__apply_paused (x) VALUES (1)`);
        if (changeSet) await tx.run(sql`INSERT INTO temp.__sealed (book_id, entry_json, change_json) VALUES (${appliedIn(bookId)}, NULL, ${JSON.stringify(changeSet)})`);
      },
      end: async (tx: Db) => {
        if (await watching(tx)) await tx.run(sql`DELETE FROM temp.__apply_paused`);
      },
      applied: async (tx: Db, changeSet: ChangeSet, bookId?: string) => {
        if (await watching(tx)) await tx.run(sql`INSERT INTO temp.__sealed (book_id, entry_json, change_json) VALUES (${appliedIn(bookId)}, NULL, ${JSON.stringify(changeSet)})`);
      },
    },
  });
}

/** The fields an upsert speaks for: those it names as changed, else every field it carries (§7.2). */
/** The field's clock in an op: the change-set's for a field it names as changed, else the one `clocks` gives (capped). */
function fieldClock(sealed: SealedOp, field: string): string {
  const op = sealed.op;
  if (op.op !== 'upsert' || (op.changed ?? Object.keys(op.fields)).includes(field)) return sealed.hlc;
  const at = op.clocks?.[field];
  return at !== undefined && at < sealed.hlc ? at : sealed.hlc;
}

/**
 * Among `after` (in hlc order), the op carrying `field` at the latest clock. On a tie a later op takes over only when its
 * sending device and the clock's device are the same member of the book (fix round 5, as apply rules a billLink tie).
 */
async function latestCarrier(database: Database, bookId: string, after: readonly SealedOp[], field: string): Promise<SealedOp | undefined> {
  const memberOf = async (deviceId: string) =>
    (await database.db.values<[string]>(sql`SELECT member_id FROM book_devices WHERE book_id = ${bookId} AND device_id = ${deviceId}`))[0]?.[0] ?? null;
  let best: SealedOp | undefined;
  for (const sealed of after) {
    if (sealed.op.op !== 'upsert' || !purchaseNames(sealed.op).includes(field)) continue;
    const at = fieldClock(sealed, field);
    if (!best || at > fieldClock(best, field)) {
      best = sealed;
      continue;
    }
    if (at !== fieldClock(best, field)) continue;
    const clockMember = await memberOf(decodeHlc(at).deviceId);
    if (clockMember !== null && clockMember === (await memberOf(decodeHlc(sealed.hlc).deviceId))) best = sealed;
  }
  return best;
}

/**
 * Among `after` (in hlc order), the op carrying a row entity's `field` at the latest clock — the clock it names the field
 * at (`fieldClock`), a resend's own older one included. On a tie the later op in order takes it, as it always has here:
 * with no resend among them, that is the last op naming the field.
 */
function rowCarrier(after: readonly SealedOp[], field: string): SealedOp | undefined {
  let best: SealedOp | undefined;
  for (const sealed of after) {
    if (sealed.op.op !== 'upsert' || !purchaseNames(sealed.op).includes(field)) continue;
    if (!best || fieldClock(sealed, field) >= fieldClock(best, field)) best = sealed;
  }
  return best;
}

const names = (op: Op): string[] => (op.op === 'upsert' ? (op.changed ?? Object.keys(op.fields)) : []);

/**
 * A purchase's fields an op speaks for: as `names`, and those it sends at their own clock too (a bill link resent at the
 * clock it went at, fix round 3) — judged by that clock (`latestCarrier`), so a newer change still wins over it.
 */
const purchaseNames = (op: Op): string[] => (op.op === 'upsert' ? [...new Set([...names(op), ...Object.keys(op.clocks ?? {})])] : []);

/**
 * Whether this phone's Debts & savings marks are still owed to the book's log (0119): held while another phone cannot
 * store one (`thirdMarkWaitsTx`, the capture run's book has no other phone at all), or, once none is behind, while some
 * other phone is missing from R7's sent-to list — R7's next pass sends every mark at the clock it was held at. With
 * every phone on that list, R7 has nothing more to send, and an unsent mark is a miss.
 */
async function thirdMarkOwed(database: Database, bookId: string): Promise<boolean> {
  const self = await localDeviceId(database.db).catch(() => null);
  if (self === null) return false;
  if (await thirdMarkWaitsTx(database.db, bookId, self)) return true;
  const others = (
    await database.db.values<[string]>(sql`SELECT device_id FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL AND device_id <> ${self}`)
  ).map(([id]) => id);
  const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${thirdMarksCrossedKey(bookId)}`);
  let crossed: unknown = [];
  try {
    crossed = row ? JSON.parse(row[0]) : [];
  } catch {
    crossed = [];
  }
  const sent = new Set(Array.isArray(crossed) ? crossed : []);
  return others.some((id) => !sent.has(id));
}

/** Whether an op sealed after `mark` carries `field` (an upsert naming it) — or, with no field, is any upsert. */
function carries(ops: readonly SealedOp[] | undefined, mark: number, field: string | null): boolean {
  return (ops ?? []).some(({ rowid, op }) => rowid > mark && op.op === 'upsert' && (field === null || names(op).includes(field)));
}

function deletedAfter(ops: readonly SealedOp[] | undefined, mark: number): boolean {
  return (ops ?? []).some(({ rowid, op }) => rowid > mark && op.op === 'delete');
}

/**
 * Whether an error only says the watch is gone — the database was closed, or restored into a new connection that has
 * none of the harness's temp tables — rather than that a check itself failed (wave 3 merge: only these may be ignored).
 */
export function watchGone(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = (e as Error & { cause?: unknown }).cause) {
    if (/database connection is not open|no such table: (temp\.)?__(writes|sealed)\b/.test(e.message)) return true;
  }
  return false;
}

type Write = { seq: number; table: string; key: string; op: string; cols: string; old: string | null; mark: number };

/**
 * Every write the triggers saw to a row of the shared book that no outbox op accounts for, described for a failure
 * message. Clears `__writes`, so each write is judged once. Empty when the watch is gone (a restore, a closed file).
 *
 * A write is accounted for only by an op sealed after the outbox's high-water mark at the time of the write, and only
 * if that op carries the field the changed column feeds:
 * - a row entity is judged by its end state against what peers will end up with: for each synced field, the value in
 *   the latest op after the mark that carries it, else the first write's before-image. A difference is a miss (so a
 *   captured A→B followed by an uncaptured B→A is caught); a row that is gone needs a delete; a new row needs an
 *   upsert. A row deleted and written back as it was needs nothing.
 * - a purchase row written in place (its transaction not inserted in this batch) needs an op naming the purchase field
 *   of each changed column (`transactions.status` excepted: a void is judged, with every lineage, by its head).
 *   Every lineage touched must have a `sync_lineage` row whose head is the lineage's posted head in the book — unless
 *   it has neither (posted and voided before anyone saw it).
 */
export async function uncapturedWrites(database: Database, bookId: string): Promise<string[]> {
  let writes: Write[];
  try {
    const rows = await database.db.values<[number, string, string, string, string, string | null, number]>(
      sql`SELECT seq, tbl, key, op, cols, old, mark FROM temp.__writes ORDER BY seq`,
    );
    writes = rows.map(([seq, table, key, op, cols, old, mark]) => ({ seq, table, key, op, cols, old, mark: Number(mark) }));
    await database.db.run(sql`DELETE FROM temp.__writes`);
  } catch (error) {
    if (watchGone(error)) return [];
    throw error;
  }
  if (writes.length === 0) return [];
  const ops = await outboxOps(database, bookId);
  const purchase = SHARED_ENTITIES.find((e) => e.kind === 'purchase') as PurchaseEntity;
  const fieldsByTable = purchaseTables(purchase);
  // Filed in the book, or a part of a split across workspaces in it (0084) — where the database has splits.
  const inBook = filedInBook(sql`t.id`, bookId, await bookSplitsExist(database.db));
  const misses: string[] = [];

  // Row entities: one judgement per row, from its first write in this batch.
  const firstWrite = new Map<string, Write>();
  for (const w of writes) if (!purchase.tables.includes(w.table) && !firstWrite.has(`${w.table}\u0000${w.key}`)) firstWrite.set(`${w.table}\u0000${w.key}`, w);
  // A plan_spread (0123) is held from the log by design while no other phone can read one (`planSpreadWaitsTx`; the
  // capture run's book has no other phone): its clocks are kept as if sent, and R9 sends it later. Not a miss.
  const plansHeld = await planSpreadWaitsTx(database.db, bookId, await localDeviceId(database.db)).catch(() => false);
  const marksHeld = await thirdMarkOwed(database, bookId);
  for (const w of firstWrite.values()) {
    const entity = SHARED_ENTITIES.find((e) => e.kind === 'row' && e.table === w.table) as RowEntity;
    if (entity.entity === 'plan_spread' && plansHeld) continue;
    const columns = syncedColumns(entity, presentColumns.get(database)?.get(entity.table));
    const key = parseOpId(entity, w.key);
    // The row as it stands in the watched book: a key alone (a member id) may name a row of another shared book too.
    const [nowRow] = await database.db.values<[string]>(
      sql`SELECT ${sql.raw(jsonOf('NEW', columns).replace(/NEW\./g, 't.'))} FROM ${sql.raw(entity.table)} t WHERE ${sql.join(
        entity.keyColumns.map((c) => sql`t.${sql.raw(c)} = ${key[c]}`),
        sql` AND `,
      )} AND ${entity.scope(bookId)}`,
    );
    const before = w.old === null ? null : (JSON.parse(w.old) as Record<string, unknown>);
    const now = nowRow ? (JSON.parse(nowRow[0]) as Record<string, unknown>) : null;
    const entityOps = ops.get(`${entity.entity}\u0000${w.key}`);
    if (!now) {
      if (before && !deletedAfter(entityOps, w.mark)) misses.push(`${w.table} ${w.key}: deleted with no ${entity.entity} delete op`);
      continue;
    }
    const fieldOf = new Map<string, string>(Object.entries(entity.fields).map(([field, column]) => [column, field]));
    for (const [field, cols] of Object.entries(entity.derivedFields ?? {})) for (const c of cols) fieldOf.set(c, field);
    // What peers end up with, per field: the latest op after the mark that carries it, else what they had before.
    const after = (entityOps ?? []).filter(({ rowid }) => rowid > w.mark);
    const latest = after.at(-1);
    if (latest?.op.op === 'delete') {
      misses.push(`${w.table} ${w.key}: the row exists but the outbox's latest ${entity.entity} op deletes it`);
      continue;
    }
    const direct = new Set(Object.values(entity.fields));
    const problems: string[] = [];
    for (const column of columns.filter((c) => fieldOf.has(c))) {
      const field = fieldOf.get(column)!;
      // The op whose word on the field is latest by the clock it carries it at, as for a purchase: a repair's resend at the
      // field's own clock (R7's held Debts & savings marks: `changed: []` and `clocks`) is a word on it, and an older
      // word that reached this phone first does not outrank it (§7.3 rule 1).
      const carrier = rowCarrier(after, field);
      if (!direct.has(column)) {
        // A derived field (a bill's payer): its value is not the column's, so only a change without an op is a miss.
        if (!carrier && (!before || JSON.stringify(before[column]) !== JSON.stringify(now[column]))) problems.push(`${column} changed with no ${entity.entity} op`);
        continue;
      }
      // A Debts & savings mark (0119) is held from the log by design (`thirdMarkWaitsTx`), its clocks kept as if sent, and
      // R7 sends it once every other phone can store it: not a miss while it is held, or while R7 has a phone still to
      // send it to. Once R7 has sent to every phone, a mark the outbox does not carry is a miss again.
      const heldMark = entity.entity === 'category_need' && field === 'need' && now[column] === 'debts_savings' && marksHeld;
      if (carrier) {
        const said = (carrier.op as { fields: Record<string, unknown> }).fields[field];
        if (heldMark && said !== now[column]) continue;
        // An own role edit the log refused (two owners stepping down at once, the last owner is never demoted): apply
        // put the row back to the authority view's role, emitting nothing, as peers never took the edit in (apply.ts
        // `reconcileMembersTx`). The log decided it, before the refused op: not a miss (wave 3 merge review round 1).
        if (entity.entity === 'member' && field === 'role' && JSON.stringify(said) !== JSON.stringify(now[column])) {
          const view = await viewMember(database.db, bookId, w.key);
          if (view && view.role === now[column] && view.roleHlc < carrier.hlc) continue;
        }
        if (JSON.stringify(said) !== JSON.stringify(now[column])) problems.push(`${column} is ${JSON.stringify(now[column])} but the outbox says ${JSON.stringify(said)}`);
      } else if (heldMark) {
        continue;
      } else if (!before || JSON.stringify(before[column]) !== JSON.stringify(now[column])) {
        problems.push(`${column} changed with no ${entity.entity} op`);
      }
    }
    const heldInsert = entity.entity === 'category_need' && now.need === 'debts_savings' && marksHeld;
    if (problems.length) misses.push(`${w.table} ${w.key}: ${problems.join('; ')}`);
    else if (!before && !heldInsert && !carries(entityOps, w.mark, null)) misses.push(`${w.table} ${w.key}: inserted with no ${entity.entity} op`);
  }

  // Purchases.
  const fresh = new Set(writes.filter((w) => w.table === 'transactions' && w.op === 'insert').map((w) => w.key));
  const lineagesChecked = new Set<string>();
  const reported = new Set<string>();
  for (const w of writes) {
    if (!purchase.tables.includes(w.table)) continue;
    const filed = await database.db.values(sql`SELECT 1 FROM transactions t WHERE t.id = ${w.key} AND ${inBook}`);
    if (filed.length === 0) continue;
    // As capture finds it (`lineageOfTransaction`): the lineage the row heads, else the one its chain started — a row
    // of a void lineage filed in the book again heads a lineage of its own.
    const [headed] = await database.db.values<[string]>(sql`SELECT lineage_id FROM sync_lineage WHERE head_transaction_id = ${w.key}`);
    const [root] = headed
      ? [headed]
      : await database.db.values<[string]>(sql`
      WITH RECURSIVE chain(id, prev, depth) AS (
        SELECT id, replaces_transaction_id, 0 FROM transactions WHERE id = ${w.key}
        UNION ALL
        SELECT t.id, t.replaces_transaction_id, c.depth + 1 FROM transactions t JOIN chain c ON t.id = c.prev
      )
      SELECT id FROM chain ORDER BY depth DESC LIMIT 1`);
    const lineageId = root?.[0] ?? w.key;

    if (!fresh.has(w.key)) {
      const fieldOf = fieldsByTable.get(w.table)!.fieldOf;
      const columns = w.cols === '*' ? [...fieldOf.keys()] : w.cols.split(',').filter(Boolean);
      const fields = [...new Set(columns.map((c) => fieldOf.get(c)).filter((f): f is string => !!f && f !== 'void'))];
      // A bill_payments row is a Pay payment's (`bill`) or a link's (`billLink`, fix round 2): either op accounts for it.
      const carried = (f: string) =>
        carries(ops.get(`purchase\u0000${lineageId}`), w.mark, f) || (f === 'bill' && w.table === 'bill_payments' && (ops.get(`purchase\u0000${lineageId}`) ?? []).some(({ rowid, op }) => rowid > w.mark && purchaseNames(op).includes('billLink')));
      const missing = fields.filter((f) => !carried(f));
      const message = `${w.table} ${w.key}: purchase ${lineageId} ${missing.join(', ')} changed with no op`;
      if (missing.length && !reported.has(message)) {
        reported.add(message);
        misses.push(message);
      }
    }

    if (lineagesChecked.has(lineageId)) continue;
    lineagesChecked.add(lineageId);
    const [lineage] = await database.db.values<[string | null, string, string, string | null, string | null]>(
      sql`SELECT head_transaction_id, paid_by, paid_label, paid_from_owner, paid_from_item FROM sync_lineage WHERE lineage_id = ${lineageId}`,
    );
    // Forward from its first row, up to a row that starts a lineage of its own. A lineage whose first row is gone from
    // this phone (a row kept in Personal when its copy was erased heads the copy's lineage there, sync gaps G5) is
    // followed from its head.
    const rootHere = (await database.db.values(sql`SELECT 1 FROM transactions WHERE id = ${lineageId}`)).length > 0;
    const start = rootHere || !lineage?.[0] ? lineageId : lineage[0];
    const [head] = await database.db.values<[string]>(sql`
      WITH RECURSIVE forward(id) AS (
        SELECT ${start}
        UNION ALL
        SELECT t.id FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id
        WHERE t.id NOT IN (SELECT lineage_id FROM sync_lineage)
      )
      SELECT t.id FROM transactions t JOIN forward f ON f.id = t.id
      WHERE t.status = 'posted' AND ${inBook}`);
    const expected = head?.[0] ?? null;
    if (!lineage) {
      if (expected !== null) misses.push(`${w.table} ${w.key}: purchase ${lineageId} has no sync_lineage row`);
      continue;
    }
    if (lineage[0] !== expected) {
      misses.push(`purchase ${lineageId}: sync_lineage head ${lineage[0]} but the posted head in the book is ${expected}`);
      continue;
    }
    // The head must read as the outbox's latest word on each field it carried since the first write here.
    // A book whose sharing stopped (§8.6) has no member here to read the purchase as: its lineage was judged above, and
    // the field-by-field reading is skipped (wave 3 merge: this used to throw, swallowed by the setup's catch).
    const [member] = await database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
    if (expected !== null && member) {
      const since = Math.min(...writes.filter((x) => x.key === w.key || x.key === expected).map((x) => x.mark));
      // Read as the lineage knows it, as capture does (`lineageRowOf`): a purchase another member paid carries the payer's
      // label, not the placeholder's name, and one they paid from this member's own item (a joint account, Paid with)
      // carries that item, which keeps the payer theirs when this member edits the row.
      const paidFrom = paidFromOf(lineage[3], lineage[4]);
      const projected = (await projectPurchase(database.db, expected, member[0], { paidBy: lineage[1], paidLabel: lineage[2], paidFrom })) as unknown as Record<string, unknown>;
      const after = (ops.get(`purchase\u0000${lineageId}`) ?? []).filter(({ rowid }) => rowid > since);
      for (const field of Object.keys(projected)) {
        // The op whose word on the field is latest, by the clock it carries the field at: a field resent at its own older
        // clock (fix round 3) loses to a newer change, as on every receiver.
        const carrier = await latestCarrier(database, bookId, after, field);
        if (!carrier) continue;
        const said = (carrier.op as { fields: Record<string, unknown> }).fields[field];
        // A figure typed with cents is kept only while the purchase's one category line rounds from it (0068): a new
        // amount from a peer that reached this phone after the figure leaves none, on every phone alike (apply.ts
        // judges both the in-place write and the repost against the lines). Not a miss.
        if (field === 'exactHundredths' && projected[field] === null && (await exactForTransactionTx(database.db, said, expected)) === null) continue;
        if (JSON.stringify(said) !== JSON.stringify(projected[field])) misses.push(`purchase ${lineageId}: ${field} reads ${JSON.stringify(projected[field])} but the outbox says ${JSON.stringify(said)}`);
      }
    }
  }
  return misses;
}

/**
 * Joint-net-worth §10's privacy check (task 6), over every change-set this device put in any outbox since the watch
 * began (the workspace log's and a net-worth group log's alike): none may carry the id of one of this device's own
 * asset or liability accounts (placeholders of other members excepted: they stand for someone else), nor the id of a
 * transaction that never was a purchase of a shared book (a lineage's own id is how a purchase travels), nor a category
 * filed only in books that are not shared (review round 1). A private
 * line's amount and description are checked by the summaries test, where they are known.
 */
export async function privateLeaks(database: Database, afterSeq = 0): Promise<string[]> {
  let rows: [string, string][];
  try {
    rows = await database.db.values<[string, string]>(
      sql`SELECT book_id, entry_json FROM temp.__sealed WHERE seq > ${afterSeq} AND book_id NOT LIKE 'applied:%' AND entry_json IS NOT NULL ORDER BY seq`,
    );
  } catch (error) {
    if (watchGone(error)) return [];
    throw error;
  }
  if (rows.length === 0) return [];
  const accountIds = (
    await database.db.values<[string]>(sql`SELECT id FROM accounts WHERE kind IN ('asset', 'liability') AND id NOT IN (SELECT account_id FROM book_member_accounts)`)
  ).map(([id]) => id);
  // A category filed only in books that are not shared here (a Business book of this person's own) is private too —
  // except in a change-set of a book it is filed in: that book was shared when it was sealed, though it may have stopped
  // sharing since (§8.6; wave 3 merge).
  const categoryIds = (
    await database.db.values<[string]>(sql`
      SELECT DISTINCT bc.category_account_id FROM book_categories bc
      WHERE bc.book_id NOT IN (SELECT book_id FROM shared_books)
        AND bc.category_account_id NOT IN (SELECT category_account_id FROM book_categories WHERE book_id IN (SELECT book_id FROM shared_books))`)
  ).map(([id]) => id);
  const filedIn = new Set(
    (await database.db.values<[string, string]>(sql`SELECT book_id, category_account_id FROM book_categories`)).map(([book, category]) => `${book}|${category}`),
  );
  // A transfer shown in a shared workspace travels under its own key (`shared_transfers.transfer_id`, the transfer's
  // first row's id): that key is the redacted row's name on every phone, never a reading of the transaction (0094, G3).
  // Kept as seen, so a book erased with its rows since still accounts for what its log carried.
  const transactionIds = (
    await database.db.values<[string]>(sql`
      SELECT id FROM transactions WHERE id NOT IN (SELECT lineage_id FROM sync_lineage) AND id NOT IN (SELECT lineage_id FROM temp.__lineages_seen)
        AND id NOT IN (SELECT transfer_id FROM temp.__transfers_seen)`)
  ).map(([id]) => id);
  const leaks: string[] = [];
  for (const [bookId, entryJson] of rows) {
    for (const id of accountIds) if (entryJson.includes(id)) leaks.push(`outbox of ${bookId} carries account ${id}`);
    for (const id of transactionIds) if (entryJson.includes(id)) leaks.push(`outbox of ${bookId} carries private transaction ${id}`);
    for (const id of categoryIds) if (!filedIn.has(`${bookId}|${id}`) && entryJson.includes(id)) leaks.push(`outbox of ${bookId} carries private category ${id}`);
  }
  return [...new Set(leaks)];
}

/** The last change-set `privateLeaks` has seen, so each is judged once (0 when the watch is gone). */
export async function lastSealedSeq(database: Database): Promise<number> {
  try {
    const [row] = await database.db.values<[number]>(sql`SELECT coalesce(max(seq), 0) FROM temp.__sealed`);
    return Number(row?.[0] ?? 0);
  } catch (error) {
    if (watchGone(error)) return 0;
    throw error;
  }
}
