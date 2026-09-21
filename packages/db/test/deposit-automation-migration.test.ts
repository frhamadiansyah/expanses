import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, createWorkspace, migrate, MIGRATIONS, openCashAccount } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const schemaOf = async (database: ReturnType<typeof createDatabase>) =>
  new Map(
    (await database.db.values<[string, string | null]>(sql`SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)).map(
      ([name, ddl]) => [name, ddl] as const,
    ),
  );

describe('migration 0054', () => {
  it('is version 54 and named deposit_automation', () => {
    expect(MIGRATIONS.find((m) => m.version === 54)).toMatchObject({ name: 'deposit_automation' });
  });

  it('adds its two tables to a version-49 database with a deposit in it, and changes nothing that was there', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 49));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await openCashAccount(database, ws, { item: 'time_deposit', name: 'BCA Deposito', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425 });
    const before = await schemaOf(database);
    const termsBefore = await database.db.values(sql`SELECT account_id, matures_on, rate_bps FROM deposit_terms`);

    expect(await migrate(database)).toContain(54);

    const after = await schemaOf(database);
    for (const [name, ddl] of before) expect(after.get(name)).toBe(ddl);
    expect(after.has('deposit_automation')).toBe(true);
    expect(after.has('deposit_events')).toBe(true);
    expect(after.has('deposit_events_once')).toBe(true);
    expect(await database.db.values(sql`SELECT account_id, matures_on, rate_bps FROM deposit_terms`)).toEqual(termsBefore);
    expect(await database.db.values(sql`SELECT count(*) FROM deposit_automation`)).toEqual([[0]]);
  });
});
