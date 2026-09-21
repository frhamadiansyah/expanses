import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrate, MIGRATIONS, setAsideTablesExist } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

describe('migration 0050', () => {
  it('is version 50 and named goal_draws', () => {
    expect(MIGRATIONS.find((m) => m.version === 50)).toMatchObject({ name: 'goal_draws' });
  });

  it('applies on a database stopped at 49, and the guard follows it', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 49));
    // A negative answer is not remembered, so the same handle sees the table once migrate has run. Called twice:
    // a broken cache that remembers the negative would only show on a second pre-migration call.
    expect(await setAsideTablesExist(older.db)).toBe(false);
    expect(await setAsideTablesExist(older.db)).toBe(false);

    expect(await migrate(older)).toEqual(MIGRATIONS.map((m) => m.version).filter((v) => v > 49));
    expect(await setAsideTablesExist(older.db)).toBe(true);
    expect(await older.db.values(sql`SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name IN ('goal_draws_account', 'goal_draws_transaction')`)).toEqual([[2]]);
  });

  it('adds no column to any existing table', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version <= 49));
    const tables = ['transactions', 'entries', 'accounts', 'goal_earmarks', 'goals', 'goal_stages'];
    const columnsOf = async (table: string) => older.db.values(sql.raw(`PRAGMA table_info(${table})`));
    const before = await Promise.all(tables.map(columnsOf));

    await migrate(older);

    const after = await Promise.all(tables.map(columnsOf));
    expect(after).toEqual(before);
  });

  it('applies after migrations numbered above it, since the runner is set-based', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    const later = { version: 99, name: 'later_test_only', sql: 'CREATE TABLE later_test_only (id TEXT PRIMARY KEY);' };
    await migrate(database, [...MIGRATIONS.filter((m) => m.version !== 50), later]);
    expect(await migrate(database, [...MIGRATIONS, later])).toEqual([50]);
  });

  it('refuses an intent it does not know and an amount of nought', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database);
    const insert = (intent: string, amount: number) =>
      database.db.values(sql`INSERT INTO goal_draws (id, workspace_id, transaction_id, goal_id, account_id, intent, amount_minor, was_whole, occurred_on, created_at)
        VALUES (${`d-${intent}-${amount}`}, 'w', 't', 'g', 'a', ${intent}, ${amount}, 0, '2026-09-19', '2026-09-19T00:00:00Z')`);
    await expect(insert('gift', 1)).rejects.toThrow();
    await expect(insert('borrow', 0)).rejects.toThrow();
    await expect(insert('borrow', 1)).resolves.toBeDefined();
  });
});
