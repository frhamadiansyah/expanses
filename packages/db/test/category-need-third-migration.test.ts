import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrate, MIGRATIONS } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const BEFORE = MIGRATIONS.filter((m) => m.version < 119);

describe('migration 0119: Debts & savings as a category mark', () => {
  it('is version 119 and named category_need_debts_savings', () => {
    expect(MIGRATIONS.find((m) => m.version === 119)).toMatchObject({ name: 'category_need_debts_savings' });
  });

  it('rebuilds category_needs keeping every row, and the sync clocks beside it, exactly as they were', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, BEFORE);
    // An older build's table refuses the third value.
    await expect(
      database.execScript(`INSERT INTO category_needs (category_account_id, workspace_id, need) VALUES ('c-x', 'w-1', 'debts_savings')`),
    ).rejects.toThrow(/CHECK/);
    await database.execScript(`
      INSERT INTO category_needs (category_account_id, workspace_id, need) VALUES ('c-dining', 'w-1', 'lifestyle'), ('c-rent', 'w-1', 'essential'), ('c-gym', 'w-2', 'lifestyle');
      INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES ('b-1', 'category_need', 'c-dining', 'need', '0000000001-0001-dev'), ('b-1', 'category_need', 'c-dining', '@row', '0000000001-0001-dev');
      INSERT INTO sync_tombstones (book_id, entity, id, hlc, last_json) VALUES ('b-1', 'category_need', 'c-old', '0000000002-0001-dev', '{"need":"lifestyle"}');`);
    const read = () => database.db.values(sql`SELECT category_account_id, workspace_id, need FROM category_needs ORDER BY category_account_id`);
    const clocks = () => database.db.values(sql`SELECT book_id, entity, id, field, hlc FROM sync_field_clocks WHERE entity = 'category_need' ORDER BY field`);
    const tombs = () => database.db.values(sql`SELECT book_id, entity, id, hlc, last_json FROM sync_tombstones WHERE entity = 'category_need'`);
    const [rowsBefore, clocksBefore, tombsBefore] = [await read(), await clocks(), await tombs()];

    expect(await migrate(database)).toContain(119);
    expect(await read()).toEqual(rowsBefore);
    expect(await clocks()).toEqual(clocksBefore);
    expect(await tombs()).toEqual(tombsBefore);
    const index = await database.db.values(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'category_needs' AND name = 'category_needs_workspace'`);
    expect(index).toHaveLength(1);

    await database.execScript(`UPDATE category_needs SET need = 'debts_savings' WHERE category_account_id = 'c-rent'`);
    expect((await read())[2]).toEqual(['c-rent', 'w-1', 'debts_savings']);
    await expect(database.execScript(`UPDATE category_needs SET need = 'luxury' WHERE category_account_id = 'c-rent'`)).rejects.toThrow(/CHECK/);
  });
});
