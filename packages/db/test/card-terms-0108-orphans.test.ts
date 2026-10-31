import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, databaseVersion, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

/**
 * 0108 rebuilds card_terms with a plain INSERT…SELECT. With foreign keys on, one row left behind by an account
 * or workspace that is gone (written while they were off) failed the whole update, and the update was put back
 * and blocked. Such a row describes a card that does not exist; it is left behind instead.
 */
describe('0108 over card terms whose account is gone', () => {
  it('copies every row that belongs to something, and leaves the orphans behind', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version < 108));
    await database.execScript(`
      INSERT INTO workspaces (id, name, type, base_currency, created_at) VALUES ('ws', 'Personal', 'personal', 'IDR', '2026-01-01T00:00:00.000Z');
      PRAGMA foreign_keys = OFF;
      INSERT INTO card_terms (account_id, workspace_id, credit_limit_minor, statement_day, due_day) VALUES ('gone-account', 'ws', 5, 25, 12);
      INSERT INTO card_terms (account_id, workspace_id, credit_limit_minor, statement_day, due_day) VALUES ('also-gone', 'gone-ws', 6, 20, 10);
      PRAGMA foreign_keys = ON;
    `);
    // A real card, whose terms must come through untouched.
    await database.execScript(`
      INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, created_at) VALUES ('card', 'ws', 'liability', 'credit_card', 'Kartu', 'IDR', '2026-01-01T00:00:00.000Z');
      INSERT INTO card_terms (account_id, workspace_id, credit_limit_minor, statement_day, due_day) VALUES ('card', 'ws', 7, 1, 20);
    `);

    await migrate(database);

    expect(await databaseVersion(database)).toBeGreaterThanOrEqual(108);
    const rows = await database.db.values<[string, number, number, number]>(sql`SELECT account_id, credit_limit_minor, statement_day, due_day FROM card_terms`);
    expect(rows).toEqual([['card', 7, 1, 20]]);
  });
});
