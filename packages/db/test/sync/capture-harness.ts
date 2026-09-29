import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { Database, Db } from '../../src/database';
import type { ChangeLogEntry } from '../../src/sync/seal';
import { configureCapture, projectPurchase } from '../../src/sync/capture';
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

/** A row entity's synced columns: its key, its fields, and the columns its derived fields stand for. */
function syncedColumns(entity: RowEntity): string[] {
  return [...new Set([...entity.keyColumns, ...Object.values(entity.fields), ...Object.values(entity.derivedFields ?? {}).flat()])];
}

/**
 * Every trigger's first condition: the book is shared right now, and the write is not apply's. A write to a book that
 * is not (yet) shared needs no op (§6.3: "a write outside a shared book emits nothing"); a write made inside
 * `withCapturePaused` is apply writing what another device already emitted, and the capture config's `pausedWrites`
 * observer (capture-setup.ts) marks exactly those with a row in `temp.__apply_paused`.
 */
const watching = (bookId: string) =>
  `NOT EXISTS (SELECT 1 FROM temp.__apply_paused) AND EXISTS (SELECT 1 FROM main.shared_books WHERE book_id = '${bookId.replace(/'/g, "''")}' AND state = 'active')`;

function rowEntityDdl(entity: RowEntity, bookId: string): string {
  const inBook = (row: 'NEW' | 'OLD') =>
    `${watching(bookId)} AND EXISTS (SELECT 1 FROM ${entity.table} t WHERE t.rowid = ${row}.rowid AND ${inline(entity.scope(bookId))})`;
  const synced = syncedColumns(entity);
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
  // Moving a row between books is a synced fact too: it is judged by the lineage's head, not by a field.
  out.get('book_transactions')!.fieldOf.set('book_id', '');
  return out;
}

function purchaseDdl(entity: PurchaseEntity, bookId: string): string {
  const parts: string[] = [];
  const when = watching(bookId);
  for (const [table, { txColumn, fieldOf }] of purchaseTables(entity)) {
    const record = (row: 'NEW' | 'OLD', op: string, cols: string) =>
      `INSERT INTO __writes (tbl, key, op, cols, old, mark) VALUES ('${table}', ${row}.${txColumn}, '${op}', ${cols}, NULL, ${MARK});`;
    const name = `__capture_${table}`;
    parts.push(`CREATE TEMP TRIGGER IF NOT EXISTS ${name}_ins AFTER INSERT ON main.${table} WHEN ${when} BEGIN ${record('NEW', 'insert', "'*'")} END;`);
    const columns = [...fieldOf.keys()];
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
  ];
  for (const entity of SHARED_ENTITIES) ddl.push(entity.kind === 'row' ? rowEntityDdl(entity, bookId) : purchaseDdl(entity, bookId));
  await database.execScript(ddl.join('\n'));
}

interface SealedOp {
  rowid: number;
  hlc: string;
  op: Op;
}

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
    // the watched book's writes: its member and device rows share their keys with the workspace's. Apply's rows carry no
    // book ('') and are kept.
    if (bookId !== '' && bookId !== watchedBookId) continue;
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
  configureCapture(database, {
    pausedWrites: {
      begin: async (tx: Db, changeSet?: ChangeSet) => {
        await tx.run(sql`INSERT INTO temp.__apply_paused (x) VALUES (1)`);
        if (changeSet) await tx.run(sql`INSERT INTO temp.__sealed (book_id, entry_json, change_json) VALUES ('', NULL, ${JSON.stringify(changeSet)})`);
      },
      end: async (tx: Db) => void (await tx.run(sql`DELETE FROM temp.__apply_paused`)),
      applied: async (tx: Db, changeSet: ChangeSet) =>
        void (await tx.run(sql`INSERT INTO temp.__sealed (book_id, entry_json, change_json) VALUES ('', NULL, ${JSON.stringify(changeSet)})`)),
    },
  });
}

/** The fields an upsert speaks for: those it names as changed, else every field it carries (§7.2). */
const names = (op: Op): string[] => (op.op === 'upsert' ? (op.changed ?? Object.keys(op.fields)) : []);

/** Whether an op sealed after `mark` carries `field` (an upsert naming it) — or, with no field, is any upsert. */
function carries(ops: readonly SealedOp[] | undefined, mark: number, field: string | null): boolean {
  return (ops ?? []).some(({ rowid, op }) => rowid > mark && op.op === 'upsert' && (field === null || names(op).includes(field)));
}

function deletedAfter(ops: readonly SealedOp[] | undefined, mark: number): boolean {
  return (ops ?? []).some(({ rowid, op }) => rowid > mark && op.op === 'delete');
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
  } catch {
    return [];
  }
  if (writes.length === 0) return [];
  const ops = await outboxOps(database, bookId);
  const purchase = SHARED_ENTITIES.find((e) => e.kind === 'purchase') as PurchaseEntity;
  const fieldsByTable = purchaseTables(purchase);
  const misses: string[] = [];

  // Row entities: one judgement per row, from its first write in this batch.
  const firstWrite = new Map<string, Write>();
  for (const w of writes) if (!purchase.tables.includes(w.table) && !firstWrite.has(`${w.table}\u0000${w.key}`)) firstWrite.set(`${w.table}\u0000${w.key}`, w);
  for (const w of firstWrite.values()) {
    const entity = SHARED_ENTITIES.find((e) => e.kind === 'row' && e.table === w.table) as RowEntity;
    const columns = syncedColumns(entity);
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
      const carrier = [...after].reverse().find(({ op }) => op.op === 'upsert' && names(op).includes(field));
      if (!direct.has(column)) {
        // A derived field (a bill's payer): its value is not the column's, so only a change without an op is a miss.
        if (!carrier && (!before || JSON.stringify(before[column]) !== JSON.stringify(now[column]))) problems.push(`${column} changed with no ${entity.entity} op`);
        continue;
      }
      if (carrier) {
        const said = (carrier.op as { fields: Record<string, unknown> }).fields[field];
        if (JSON.stringify(said) !== JSON.stringify(now[column])) problems.push(`${column} is ${JSON.stringify(now[column])} but the outbox says ${JSON.stringify(said)}`);
      } else if (!before || JSON.stringify(before[column]) !== JSON.stringify(now[column])) {
        problems.push(`${column} changed with no ${entity.entity} op`);
      }
    }
    if (problems.length) misses.push(`${w.table} ${w.key}: ${problems.join('; ')}`);
    else if (!before && !carries(entityOps, w.mark, null)) misses.push(`${w.table} ${w.key}: inserted with no ${entity.entity} op`);
  }

  // Purchases.
  const fresh = new Set(writes.filter((w) => w.table === 'transactions' && w.op === 'insert').map((w) => w.key));
  const lineagesChecked = new Set<string>();
  const reported = new Set<string>();
  for (const w of writes) {
    if (!purchase.tables.includes(w.table)) continue;
    const filed = await database.db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${w.key} AND book_id = ${bookId}`);
    if (filed.length === 0) continue;
    const [root] = await database.db.values<[string]>(sql`
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
      const missing = fields.filter((f) => !carries(ops.get(`purchase\u0000${lineageId}`), w.mark, f));
      const message = `${w.table} ${w.key}: purchase ${lineageId} ${missing.join(', ')} changed with no op`;
      if (missing.length && !reported.has(message)) {
        reported.add(message);
        misses.push(message);
      }
    }

    if (lineagesChecked.has(lineageId)) continue;
    lineagesChecked.add(lineageId);
    const [lineage] = await database.db.values<[string | null, string, string]>(sql`SELECT head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${lineageId}`);
    const [head] = await database.db.values<[string]>(sql`
      WITH RECURSIVE forward(id) AS (
        SELECT ${lineageId}
        UNION ALL
        SELECT t.id FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id
      )
      SELECT t.id FROM transactions t JOIN forward f ON f.id = t.id
      WHERE t.status = 'posted' AND t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})`);
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
    if (expected !== null) {
      const since = Math.min(...writes.filter((x) => x.key === w.key || x.key === expected).map((x) => x.mark));
      const [member] = await database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
      // Read as the lineage knows it: a purchase another member paid carries the payer's label, not the placeholder's name.
      const projected = (await projectPurchase(database.db, expected, member![0], { paidBy: lineage[1], paidLabel: lineage[2] })) as unknown as Record<string, unknown>;
      const after = (ops.get(`purchase\u0000${lineageId}`) ?? []).filter(({ rowid }) => rowid > since);
      for (const field of Object.keys(projected)) {
        const carrier = [...after].reverse().find(({ op }) => op.op === 'upsert' && names(op).includes(field));
        if (!carrier) continue;
        const said = (carrier.op as { fields: Record<string, unknown> }).fields[field];
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
 * transaction that never was a purchase of a shared book (a lineage's own id is how a purchase travels). A private
 * line's amount and description are checked by the summaries test, where they are known.
 */
export async function privateLeaks(database: Database): Promise<string[]> {
  let rows: [string, string][];
  try {
    rows = await database.db.values<[string, string]>(sql`SELECT book_id, entry_json FROM temp.__sealed WHERE book_id <> '' AND entry_json IS NOT NULL ORDER BY seq`);
  } catch {
    return [];
  }
  if (rows.length === 0) return [];
  const accountIds = (
    await database.db.values<[string]>(sql`SELECT id FROM accounts WHERE kind IN ('asset', 'liability') AND id NOT IN (SELECT account_id FROM book_member_accounts)`)
  ).map(([id]) => id);
  const transactionIds = (await database.db.values<[string]>(sql`SELECT id FROM transactions WHERE id NOT IN (SELECT lineage_id FROM sync_lineage)`)).map(([id]) => id);
  const leaks: string[] = [];
  for (const [bookId, entryJson] of rows) {
    for (const id of accountIds) if (entryJson.includes(id)) leaks.push(`outbox of ${bookId} carries account ${id}`);
    for (const id of transactionIds) if (entryJson.includes(id)) leaks.push(`outbox of ${bookId} carries private transaction ${id}`);
  }
  return [...new Set(leaks)];
}
