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
    expect(await migrate(database)).toEqual([1, 2, 3]);
    expect(await migrate(database)).toEqual([]);
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
