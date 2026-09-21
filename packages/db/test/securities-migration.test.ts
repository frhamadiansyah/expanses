import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccount, createDatabase, createWorkspace, databaseVersion, listHoldingLinks, listSecurities, migrate, MIGRATIONS, nativeBalances,
  saveAssetProfile, securityTablesExist,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => { executor?.close(); executor = undefined; });

const schemaOf = async (database: ReturnType<typeof createDatabase>) =>
  new Map(
    (await database.db.values<[string, string | null]>(sql`SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`)).map(
      ([name, ddl]) => [name, ddl] as const,
    ),
  );

describe('migration 0051', () => {
  it('is version 51 and named securities', () => {
    expect(MIGRATIONS.find((m) => m.version === 51)).toMatchObject({ name: 'securities' });
  });

  it('adds three tables to a database without them, and the guard answers only once they exist', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version !== 51));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    expect(await securityTablesExist(older.db)).toBe(false);
    expect(await listSecurities(older, ws)).toEqual([]);
    expect(await listHoldingLinks(older, ws)).toEqual([]);

    expect(await migrate(older)).toEqual([51]);
    // A "no" was not remembered, so the same handle now says yes.
    expect(await securityTablesExist(older.db)).toBe(true);
    const columns = async (table: string) => (await older.db.values<unknown[]>(sql.raw(`PRAGMA table_info(${table})`))).map((row) => String(row[1]));
    expect(await columns('securities')).toEqual(['id', 'workspace_id', 'ticker', 'name', 'market', 'currency', 'lot_size', 'kind', 'source', 'created_at']);
    expect(await columns('holding_links')).toEqual(['account_id', 'workspace_id', 'security_id', 'broker_account_id', 'created_at']);
    expect(await columns('security_prices')).toEqual(['security_id', 'workspace_id', 'on_date', 'price_micro', 'source', 'created_at']);
  });

  it('lands last on a database that already has every later migration, and changes nothing that was there', async () => {
    // The order a real user meets: 0050, 0053, 0054 (and any later one) applied first, 0051 after them.
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    const without = MIGRATIONS.filter((m) => m.version !== 51);
    await migrate(database, without);
    expect(await databaseVersion(database)).toBe(Math.max(...without.map((m) => m.version)));
    expect(Math.max(...without.map((m) => m.version))).toBeGreaterThan(51);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 12_345_678, openedOn: '2026-01-01' });
    const stock = await createAccount(database, ws, { name: 'BBCA', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: stock.id, assetKind: 'stock' });
    const before = await schemaOf(database);
    const balancesBefore = await nativeBalances(database, ws);

    expect(await migrate(database)).toEqual([51]);

    const after = await schemaOf(database);
    for (const [name, ddl] of before) expect(after.get(name)).toBe(ddl);
    expect([...after.keys()].filter((name) => !before.has(name)).sort()).toEqual(
      ['holding_links', 'holding_links_security', 'securities', 'securities_ticker', 'security_prices'],
    );
    expect(await nativeBalances(database, ws)).toEqual(balancesBefore);
    expect(balancesBefore[bank.id]).toBe(12_345_678);
    expect(await databaseVersion(database)).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
    expect(await migrate(database)).toEqual([]);
  });
});
