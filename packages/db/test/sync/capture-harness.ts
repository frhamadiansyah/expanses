import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { Database } from '../../src/database';
import type { ChangeLogEntry } from '../../src/sync/seal';
import { IdentitySealer } from '../../src/sync/seal';
import { SHARED_ENTITIES, type PurchaseEntity, type RowEntity } from '../../src/sync/shared-entities';

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

function rowEntityDdl(entity: RowEntity, bookId: string): string {
  const inBook = (row: 'NEW' | 'OLD') => `EXISTS (SELECT 1 FROM ${entity.table} t WHERE t.rowid = ${row}.rowid AND ${inline(entity.scope(bookId))})`;
  const record = (row: 'NEW' | 'OLD', op: string) =>
    `INSERT INTO __writes (tbl, key, op) VALUES ('${entity.table}', ${keyExpr(row, entity.keyColumns)}, '${op}');`;
  const synced = [...new Set([...entity.keyColumns, ...Object.values(entity.fields), ...Object.values(entity.derivedFields ?? {}).flat()])];
  const name = `__capture_${entity.table}`;
  return `
    CREATE TEMP TRIGGER IF NOT EXISTS ${name}_ins AFTER INSERT ON main.${entity.table} WHEN ${inBook('NEW')}
    BEGIN ${record('NEW', 'insert')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name}_upd AFTER UPDATE OF ${synced.join(', ')} ON main.${entity.table}
    WHEN (${changed(synced)}) AND ${inBook('NEW')}
    BEGIN ${record('NEW', 'update')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name}_del BEFORE DELETE ON main.${entity.table} WHEN ${inBook('OLD')}
    BEGIN ${record('OLD', 'delete')} END;`;
}

/** Per purchase table: the column naming its transaction, and the synced columns an update is watched on. */
function purchaseTables(entity: PurchaseEntity): Map<string, { txColumn: string; synced: string[] }> {
  const out = new Map<string, { txColumn: string; synced: string[] }>();
  for (const table of entity.tables) out.set(table, { txColumn: table === 'transactions' ? 'id' : 'transaction_id', synced: [] });
  for (const columns of Object.values(entity.fields)) {
    for (const qualified of columns) {
      const [table, column] = qualified.split('.') as [string, string];
      out.get(table)!.synced.push(column);
    }
  }
  // Moving a row between books is a synced fact too.
  out.get('book_transactions')!.synced.push('book_id');
  return out;
}

function purchaseDdl(entity: PurchaseEntity): string {
  const parts: string[] = [];
  for (const [table, { txColumn, synced }] of purchaseTables(entity)) {
    const record = (row: 'NEW' | 'OLD', op: string) => `INSERT INTO __writes (tbl, key, op) VALUES ('${table}', ${row}.${txColumn}, '${op}');`;
    const name = `__capture_${table}`;
    parts.push(`CREATE TEMP TRIGGER IF NOT EXISTS ${name}_ins AFTER INSERT ON main.${table} BEGIN ${record('NEW', 'insert')} END;`);
    if (synced.length) {
      const columns = [...new Set(synced)];
      parts.push(
        `CREATE TEMP TRIGGER IF NOT EXISTS ${name}_upd AFTER UPDATE OF ${columns.join(', ')} ON main.${table} WHEN (${changed(columns)}) BEGIN ${record('NEW', 'update')} END;`,
      );
    }
    parts.push(`CREATE TEMP TRIGGER IF NOT EXISTS ${name}_del AFTER DELETE ON main.${table} BEGIN ${record('OLD', 'delete')} END;`);
  }
  return parts.join('\n');
}

/** Installs §6.4's triggers for one shared book. Idempotent. */
export async function installCaptureTriggers(database: Database, bookId: string): Promise<void> {
  const ddl = [`CREATE TEMP TABLE IF NOT EXISTS __writes (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, key TEXT NOT NULL, op TEXT NOT NULL);`];
  for (const entity of SHARED_ENTITIES) ddl.push(entity.kind === 'row' ? rowEntityDdl(entity, bookId) : purchaseDdl(entity));
  await database.execScript(ddl.join('\n'));
}

async function outboxOpKeys(database: Database): Promise<Set<string>> {
  const rows = await database.db.values<[string, string]>(sql`SELECT book_id, entry_json FROM sync_outbox`);
  const opener = new IdentitySealer('harness');
  const keys = new Set<string>();
  for (const [bookId, json] of rows) {
    const changeSet = await opener.open(bookId, JSON.parse(json) as ChangeLogEntry);
    for (const op of changeSet.ops) keys.add(`${op.entity}\u0000${op.id}`);
  }
  return keys;
}

/**
 * Every write the triggers saw to a row of the shared book that no outbox op accounts for, described for a failure
 * message. Clears `__writes`, so each write is judged once. Empty when the watch is gone (a restore, a closed file).
 */
export async function uncapturedWrites(database: Database, bookId: string): Promise<string[]> {
  let writes: [string, string, string][];
  try {
    writes = await database.db.values<[string, string, string]>(sql`SELECT tbl, key, group_concat(DISTINCT op) FROM temp.__writes GROUP BY tbl, key ORDER BY min(seq)`);
    await database.db.run(sql`DELETE FROM temp.__writes`);
  } catch {
    return [];
  }
  if (writes.length === 0) return [];
  const ops = await outboxOpKeys(database);
  const purchase = SHARED_ENTITIES.find((e) => e.kind === 'purchase') as PurchaseEntity;
  const misses: string[] = [];
  const lineagesChecked = new Set<string>();

  for (const [table, key, what] of writes) {
    if (!purchase.tables.includes(table)) {
      const entity = SHARED_ENTITIES.find((e) => e.kind === 'row' && e.table === table)!;
      if (!ops.has(`${entity.entity}\u0000${key}`)) misses.push(`${table} ${key} (${what}): no ${entity.entity} op`);
      continue;
    }
    // A purchase table: only rows whose transaction is filed in the shared book are the book's.
    const filed = await database.db.values(sql`SELECT 1 FROM book_transactions WHERE transaction_id = ${key} AND book_id = ${bookId}`);
    if (filed.length === 0) continue;
    const [root] = await database.db.values<[string]>(sql`
      WITH RECURSIVE chain(id, prev, depth) AS (
        SELECT id, replaces_transaction_id, 0 FROM transactions WHERE id = ${key}
        UNION ALL
        SELECT t.id, t.replaces_transaction_id, c.depth + 1 FROM transactions t JOIN chain c ON t.id = c.prev
      )
      SELECT id FROM chain ORDER BY depth DESC LIMIT 1`);
    const lineageId = root?.[0] ?? key;
    if (lineagesChecked.has(lineageId)) continue;
    lineagesChecked.add(lineageId);
    const [lineage] = await database.db.values<[string | null]>(sql`SELECT head_transaction_id FROM sync_lineage WHERE lineage_id = ${lineageId}`);
    if (!lineage) {
      misses.push(`${table} ${key} (${what}): purchase ${lineageId} has no sync_lineage row`);
      continue;
    }
    if (!ops.has(`purchase\u0000${lineageId}`)) misses.push(`${table} ${key} (${what}): no purchase op for lineage ${lineageId}`);
    const [head] = await database.db.values<[string]>(sql`
      WITH RECURSIVE forward(id) AS (
        SELECT ${lineageId}
        UNION ALL
        SELECT t.id FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id
      )
      SELECT t.id FROM transactions t JOIN forward f ON f.id = t.id
      WHERE t.status = 'posted' AND t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})`);
    const expected = head?.[0] ?? null;
    if (lineage[0] !== expected) misses.push(`purchase ${lineageId}: sync_lineage head ${lineage[0]} but the posted head in the book is ${expected}`);
  }
  return misses;
}
