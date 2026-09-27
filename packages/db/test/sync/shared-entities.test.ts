import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/index';
import type { NodeExecutor } from '../../src/node';
import { buildOpId, NEVER_SYNCED_COLUMNS, parseOpId, SHARED_ENTITIES, type PurchaseEntity, type RowEntity } from '../../src/sync/shared-entities';
import { setupDb } from '../helpers';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function fresh() {
  const db = await setupDb();
  executor = db.executor;
  return db;
}

async function columnsOf(database: Database, table: string): Promise<string[]> {
  const rows = await database.db.values<[number, string]>(sql.raw(`SELECT cid, name FROM pragma_table_info('${table}')`));
  return rows.map((r) => r[1]);
}

async function tableExists(database: Database, table: string): Promise<boolean> {
  const rows = await database.db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`);
  return rows.length > 0;
}

const rows = SHARED_ENTITIES.filter((e): e is RowEntity => e.kind === 'row');
const existing = rows.filter((e) => !e.createdBy0056);
const purchase = SHARED_ENTITIES.find((e): e is PurchaseEntity => e.kind === 'purchase')!;

describe('SHARED_ENTITIES against a freshly migrated database', () => {
  it('names each entity once', () => {
    const names = SHARED_ENTITIES.map((e) => e.entity);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(existing.map((e) => [e.entity, e] as const))('%s: every column of its table is a key, a field, or never synced', async (_name, entity) => {
    const { database } = await fresh();
    const columns = await columnsOf(database, entity.table);
    expect(columns.length, `${entity.table} exists`).toBeGreaterThan(0);
    const named = [
      ...entity.keyColumns,
      ...Object.values(entity.fields),
      ...Object.values(entity.derivedFields ?? {}).flat(),
      ...(NEVER_SYNCED_COLUMNS[entity.table] ?? []),
    ];
    // What apply writes locally on insert is a column that never travels.
    for (const column of entity.localOnInsert) expect(NEVER_SYNCED_COLUMNS[entity.table], `${entity.table}.${column}`).toContain(column);
    // Each named column exists, and each column is named: a column added later must be sorted into one list.
    for (const column of named) expect(columns, `${entity.table}.${column}`).toContain(column);
    expect([...new Set(named)].sort()).toEqual([...columns].sort());
    // A column is in exactly one list.
    expect(named.length).toBe(new Set(named).size);
  });

  it.each(existing.map((e) => [e.entity, e] as const))('%s: its scope predicate runs', async (_name, entity) => {
    const { database, ws } = await fresh();
    const [row] = await database.db.values<[number]>(sql`SELECT count(*) FROM ${sql.raw(entity.table)} t WHERE ${entity.scope('book-' + ws.workspaceId)}`);
    expect(typeof row![0]).toBe('number');
  });

  it('the tables of member and device come with migration 0056, and not before', async () => {
    const { database } = await fresh();
    const pending = rows.filter((e) => e.createdBy0056).map((e) => e.table);
    expect(pending.sort()).toEqual(['book_devices', 'book_members']);
    for (const table of pending) expect(await tableExists(database, table)).toBe(false);
  });

  it('purchase: every column of its five tables is a field, a link, or never synced', async () => {
    const { database, ws } = await fresh();
    const named = [...Object.values(purchase.fields).flat(), ...purchase.linkColumns];
    for (const table of purchase.tables) {
      const columns = await columnsOf(database, table);
      expect(columns.length, `${table} exists`).toBeGreaterThan(0);
      const here = [...named.filter((c) => c.startsWith(table + '.')).map((c) => c.slice(table.length + 1)), ...(NEVER_SYNCED_COLUMNS[table] ?? [])];
      for (const column of here) expect(columns, `${table}.${column}`).toContain(column);
      expect([...new Set(here)].sort()).toEqual([...columns].sort());
    }
    const [row] = await database.db.values<[number]>(sql`SELECT count(*) FROM transactions t WHERE ${purchase.scope('book-' + ws.workspaceId)}`);
    expect(typeof row![0]).toBe('number');
  });

  it('never syncs workspace_id', () => {
    for (const e of rows) {
      expect(Object.values(e.fields)).not.toContain('workspace_id');
      expect(e.keyColumns).not.toContain('workspace_id');
    }
    expect(Object.values(purchase.fields).flat().some((c) => c.endsWith('.workspace_id'))).toBe(false);
  });
});

describe('Op.id', () => {
  it('joins a composite key with | in key order, without workspace_id, and parses back', () => {
    const skip = SHARED_ENTITIES.find((e) => e.entity === 'bill_skip')!;
    const id = buildOpId(skip, { template_id: 'tpl-1', month: '2026-09' });
    expect(id).toBe('tpl-1|2026-09');
    expect(parseOpId(skip, id)).toEqual({ template_id: 'tpl-1', month: '2026-09' });
    const override = SHARED_ENTITIES.find((e) => e.entity === 'book_income_override')!;
    expect(buildOpId(override, { book_id: 'b', month: '2026-01' })).toBe('b|2026-01');
  });

  it('refuses a key part that holds the separator, and an id with the wrong number of parts', () => {
    const skip = SHARED_ENTITIES.find((e) => e.entity === 'bill_skip')!;
    expect(() => buildOpId(skip, { template_id: 'a|b', month: '2026-09' })).toThrow();
    expect(() => parseOpId(skip, 'only-one')).toThrow();
  });
});
