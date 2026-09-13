import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrate, schema } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor;
afterEach(() => executor?.close());

async function fresh() {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  return database;
}

describe('database', () => {
  it('migrates once and is idempotent', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    expect(await migrate(database)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(await migrate(database)).toEqual([]);
  });

  it('adds catalogue columns and tables', async () => {
    const database = await fresh();
    const columns = async (table: string) => (await database.db.values<unknown[]>(sql.raw(`PRAGMA table_info(${table})`))).map((row) => String(row[1]));
    expect(await columns('transactions')).toEqual(expect.arrayContaining(['original_currency', 'original_amount_minor']));
    expect(await columns('reward_programs')).toEqual(
      expect.arrayContaining(['catalog_entry_id', 'catalog_entry_version', 'catalog_status', 'catalog_dismissed_version', 'catalog_snapshot_json']),
    );
    expect(await columns('earn_rules')).toContain('catalog_key');
    expect(await columns('redemption_options')).toContain('catalog_key');
    expect(await columns('cycle_bonuses')).toEqual(['id', 'workspace_id', 'program_id', 'key', 'name', 'tiers_json', 'match_json', 'valid_from', 'valid_to', 'catalog_key', 'archived_at', 'created_at']);
    expect(await columns('transfer_partners')).toEqual([
      'id', 'workspace_id', 'program_id', 'key', 'program_name', 'points', 'partner_units', 'increment_points', 'valid_from', 'valid_to', 'catalog_key', 'archived_at', 'created_at',
    ]);
  });

  it('adds MCC and per-purchase points columns and tables', async () => {
    const database = await fresh();
    const columns = async (table: string) => (await database.db.values<unknown[]>(sql.raw(`PRAGMA table_info(${table})`))).map((row) => String(row[1]));
    expect(await columns('transactions')).toContain('mcc');
    expect(await columns('reward_programs')).toContain('crediting');
    expect(await columns('merchant_mccs')).toEqual(['id', 'workspace_id', 'pattern', 'mcc', 'created_at', 'archived_at']);
    expect(await columns('category_mccs')).toEqual(['category_id', 'workspace_id', 'mcc']);
    expect(await columns('transaction_point_actuals')).toEqual(['workspace_id', 'program_id', 'transaction_id', 'actual_points', 'edited_after_check', 'recorded_at']);
  });

  it('maps get, all, and values through the proxy', async () => {
    const database = await fresh();
    await database.db.insert(schema.settings).values([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    const all = await database.db.select().from(schema.settings).orderBy(schema.settings.key);
    expect(all).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
    const one = await database.db.select().from(schema.settings).where(sql`key = 'b'`).get();
    expect(one).toEqual({ key: 'b', value: '2' });
    const missing = await database.db.select().from(schema.settings).where(sql`key = 'z'`).get();
    expect(missing).toBeUndefined();
    expect(await database.db.values(sql`SELECT count(*) FROM settings`)).toEqual([[2]]);
  });

  it('rolls back a failed transaction and serializes concurrent work', async () => {
    const database = await fresh();
    await expect(
      database.transaction(async (tx) => {
        await tx.insert(schema.settings).values({ key: 'x', value: '1' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const concurrent = database.db.insert(schema.settings).values({ key: 'y', value: '1' });
    await database.transaction(async (tx) => {
      await tx.insert(schema.settings).values({ key: 'z', value: '1' });
    });
    await concurrent;
    const keys = (await database.db.select().from(schema.settings)).map((r) => r.key).sort();
    expect(keys).toEqual(['y', 'z']);
  });

  it('round-trips the database through export and import', async () => {
    const database = await fresh();
    await database.db.insert(schema.settings).values({ key: 'kept', value: 'yes' });
    const bytes = await database.exportBytes();
    await database.db.delete(schema.settings);
    await database.importBytes(bytes);
    expect(await database.db.select().from(schema.settings)).toEqual([{ key: 'kept', value: 'yes' }]);
  });
});

describe('review fixes: rollback failure', () => {
  it('rethrows the original error when ROLLBACK itself fails', async () => {
    const inner = createNodeExecutor();
    executor = inner;
    const flaky = { ...inner, execScript: async (sql: string) => { if (sql === 'ROLLBACK') throw new Error('rollback failed'); return inner.execScript(sql); } };
    const database = createDatabase(flaky);
    await expect(database.transaction(async () => { throw new Error('original'); })).rejects.toThrow('original');
  });
});
