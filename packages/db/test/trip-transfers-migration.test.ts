import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

/*
 * Migration 0114 (trip withdrawal): a household-shared workspace's transfer may name the shared event it is listed on.
 * A database from before it: one redacted transfer, and the clock an older build kept for a field it could not write.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function before0114(): Promise<Database> {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version < 114));
  return database;
}

const columns = async (database: Database, table: string) => (await database.db.values<[number, string]>(sql.raw(`SELECT cid, name FROM pragma_table_info('${table}')`))).map((r) => r[1]);

describe('migration 0114 (trip transfers)', () => {
  it('is version 114 and named trip_transfers', () => {
    expect(MIGRATIONS.find((m) => m.version === 114)).toMatchObject({ name: 'trip_transfers' });
  });

  it('adds event_book_id, null on every row there was, and drops only the clocks an older build kept for it', async () => {
    const database = await before0114();
    expect(await columns(database, 'shared_transfers')).not.toContain('event_book_id');
    await database.db.run(sql`
      INSERT INTO shared_transfers (book_id, transfer_id, occurred_on, amount_minor, currency, description, recorded_by, void, transaction_id)
      VALUES ('book-1', 'transfer-1', '2026-10-08', 150000, 'IDR', 'ATM withdrawal', 'member-1', 0, NULL)`);
    for (const field of ['eventBookId', 'description']) {
      await database.db.run(sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES ('book-1', 'book_transfer', 'transfer-1', ${field}, '0001')`);
    }
    await database.db.run(sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES ('book-1', 'nw_item', 'item-1', 'eventBookId', '0001')`);
    await migrate(database);
    expect(await columns(database, 'shared_transfers')).toContain('event_book_id');
    expect(await database.db.values(sql`SELECT transfer_id, event_book_id FROM shared_transfers`)).toEqual([['transfer-1', null]]);
    expect(await database.db.values(sql`SELECT entity, field FROM sync_field_clocks ORDER BY entity, field`)).toEqual([
      ['book_transfer', 'description'],
      ['nw_item', 'eventBookId'],
    ]);
  });
});
