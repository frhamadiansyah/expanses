import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, assetValuesAt, createAccount, createDatabase, createWorkspace, type Database, linkHolding, listPrices, listSecurities,
  migrate, MIGRATIONS, recordTrade, saveAssetProfile, upsertPrice, upsertSecurityPrice, type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const shares = (n: number) => n * 1_000_000;
const idr = (rupiah: number) => rupiah * 1_000_000; // a price per share, in millionths of a rupiah

let database: Database;
let ws: WorkspaceContext;
let stockbitBbca: AccountRow;
let mandiriBbca: AccountRow;
let gold: AccountRow;

async function holdingWith(name: string, units: number, costMinor: number, kind: 'stock' | 'gold' = 'stock') {
  const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: kind });
  await recordTrade(database, ws, { accountId: account.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: units, grossMinor: costMinor, feeMinor: 0, taxMinor: 0, cashAccountId: null });
  return account;
}
const valueOn = async (date: string, id: string) => (await assetValuesAt(database, ws, date)).find((row) => row.accountId === id)!.valueMinor;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  stockbitBbca = await holdingWith('BBCA · Stockbit', shares(1_000), 8_750_000);
  mandiriBbca = await holdingWith('BBCA · Mandiri', shares(500), 4_700_000);
  gold = await holdingWith('Antam gold bars', shares(10), 18_600_000, 'gold');
  const bbca = { ticker: 'BBCA', name: 'BBCA', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const, source: 'catalogue' as const };
  await linkHolding(database, ws, { accountId: stockbitBbca.id, security: bbca });
  await linkHolding(database, ws, { accountId: mandiriBbca.id, security: bbca });
});

describe('one price per security', () => {
  it('values every holding of the security from one entry', async () => {
    const [security] = await listSecurities(database, ws);
    await upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: idr(9_775) });
    expect(await valueOn('2026-09-19', stockbitBbca.id)).toBe(9_775_000);
    expect(await valueOn('2026-09-19', mandiriBbca.id)).toBe(4_887_500);
  });

  it('routes a price typed on either holding to the security, so no screen types a price nothing reads', async () => {
    await upsertPrice(database, ws, { accountId: mandiriBbca.id, onDate: '2026-09-20', priceMicro: idr(9_800) });
    expect(await valueOn('2026-09-20', stockbitBbca.id)).toBe(9_800_000);
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${mandiriBbca.id}`)).toEqual([[0]]);
    expect(await listPrices(database, ws, stockbitBbca.id)).toEqual([{ onDate: '2026-09-20', priceMicro: idr(9_800) }]);
  });

  it('leaves a holding with no security exactly as it was', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-20', priceMicro: idr(1_900_000) });
    expect(await listPrices(database, ws, gold.id)).toEqual([{ onDate: '2026-09-20', priceMicro: idr(1_900_000) }]);
    expect(await valueOn('2026-09-20', gold.id)).toBe(19_000_000);
  });
});

describe('on a database without 0051', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => { executor?.close(); executor = undefined; });

  it('prices and values holdings exactly as before', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version !== 51));
    const ows = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bar = await createAccount(older, ows, { name: 'Gold', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(older, ows, { accountId: bar.id, assetKind: 'gold' });
    await recordTrade(older, ows, { accountId: bar.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: shares(10), grossMinor: 18_600_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await upsertPrice(older, ows, { accountId: bar.id, onDate: '2026-09-20', priceMicro: idr(1_900_000) });
    expect(await listPrices(older, ows, bar.id)).toEqual([{ onDate: '2026-09-20', priceMicro: idr(1_900_000) }]);
    expect((await assetValuesAt(older, ows, '2026-09-20'))[0]!.valueMinor).toBe(19_000_000);
  });
});
