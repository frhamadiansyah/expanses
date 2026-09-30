import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, assetValuesAt, createAccount, createWorkspace, type Database, latestSecurityPrices, linkHolding, listPrices, listSecurities,
  recordListedClose, recordListedCloses, recordTrade, saveAssetProfile, listSecurityPriceChoices, setSecurityPriceChoice, upsertPrice, upsertSecurityPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const idr = (rupiah: number) => rupiah * 1_000_000; // a price per share, in millionths of a rupiah

let database: Database;
let ws: WorkspaceContext;
let holding: AccountRow;
let bbca: string;
let bbri: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  holding = await createAccount(database, ws, { name: 'BBCA · Stockbit', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: holding.id, assetKind: 'stock' });
  await recordTrade(database, ws, { accountId: holding.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: 1_000 * 1_000_000, grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
  await linkHolding(database, ws, { accountId: holding.id, security: { ticker: 'BBCA', name: 'BBCA', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' } });
  const other = await createAccount(database, ws, { name: 'BBRI', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await linkHolding(database, ws, { accountId: other.id, security: { ticker: 'BBRI', name: 'BBRI', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' } });
  const securities = await listSecurities(database, ws);
  bbca = securities.find((s) => s.ticker === 'BBCA')!.id;
  bbri = securities.find((s) => s.ticker === 'BBRI')!.id;
});

describe('a close from Yahoo Finance', () => {
  it('is the day’s price, marked as fetched, and values the holding', async () => {
    expect(await recordListedClose(database, ws, { securityId: bbca, onDate: '2026-09-29', priceMicro: idr(6_150), source: 'yahoo' })).toBe('saved');
    expect(await listPrices(database, ws, holding.id)).toEqual([{ onDate: '2026-09-29', priceMicro: idr(6_150), source: 'yahoo' }]);
    expect((await assetValuesAt(database, ws, '2026-09-30')).find((row) => row.accountId === holding.id)!.valueMinor).toBe(6_150_000);
  });

  it('never replaces a price typed for that day, and a typed price replaces it', async () => {
    await upsertSecurityPrice(database, ws, { securityId: bbca, onDate: '2026-09-29', priceMicro: idr(6_100) });
    expect(await recordListedClose(database, ws, { securityId: bbca, onDate: '2026-09-29', priceMicro: idr(6_150), source: 'yahoo' })).toBe('kept');
    expect(await listPrices(database, ws, holding.id)).toEqual([{ onDate: '2026-09-29', priceMicro: idr(6_100), source: 'manual' }]);

    await recordListedClose(database, ws, { securityId: bbca, onDate: '2026-09-30', priceMicro: idr(6_075), source: 'yahoo' });
    await upsertPrice(database, ws, { accountId: holding.id, onDate: '2026-09-30', priceMicro: idr(6_000) });
    expect((await listPrices(database, ws, holding.id))[0]).toEqual({ onDate: '2026-09-30', priceMicro: idr(6_000), source: 'manual' });
  });

  it('replaces an earlier outside close for the same day', async () => {
    await recordListedClose(database, ws, { securityId: bbca, onDate: '2026-09-29', priceMicro: idr(6_125), source: 'yahoo' });
    await recordListedClose(database, ws, { securityId: bbca, onDate: '2026-09-29', priceMicro: idr(6_150), source: 'idx' });
    expect(await listPrices(database, ws, holding.id)).toEqual([{ onDate: '2026-09-29', priceMicro: idr(6_150), source: 'idx' }]);
  });
});

describe('an IDX file’s closes', () => {
  it('are saved together for the file’s day, keeping a typed price and naming it', async () => {
    await upsertSecurityPrice(database, ws, { securityId: bbri, onDate: '2026-09-29', priceMicro: idr(3_200) });
    const result = await recordListedCloses(database, ws, {
      onDate: '2026-09-29',
      source: 'idx',
      closes: [
        { securityId: bbca, priceMicro: idr(6_150) },
        { securityId: bbri, priceMicro: idr(3_170) },
      ],
    });
    expect(result).toEqual({ saved: [bbca], kept: [bbri] });
    const latest = await latestSecurityPrices(database, ws);
    expect(latest[bbca]).toEqual({ onDate: '2026-09-29', priceMicro: idr(6_150), source: 'idx' });
    expect(latest[bbri]).toEqual({ onDate: '2026-09-29', priceMicro: idr(3_200), source: 'manual' });
  });
});

describe('the price source', () => {
  it('is nothing saved until chosen, and keeps the prices either way', async () => {
    expect(await listSecurityPriceChoices(database, ws)).toEqual({});
    await recordListedClose(database, ws, { securityId: bbca, onDate: '2026-09-29', priceMicro: idr(6_150), source: 'yahoo' });
    await setSecurityPriceChoice(database, ws, bbca, 'typed');
    await setSecurityPriceChoice(database, ws, bbca, 'idx');
    expect(await listSecurityPriceChoices(database, ws)).toEqual({ [bbca]: 'idx' });
    expect(await listPrices(database, ws, holding.id)).toHaveLength(1);
  });

  it('refuses a security from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(setSecurityPriceChoice(database, other, bbca, 'typed')).rejects.toThrow();
    await expect(recordListedClose(database, other, { securityId: bbca, onDate: '2026-09-29', priceMicro: 1, source: 'idx' })).rejects.toThrow();
  });
});

describe('migration 0062', () => {
  it('keeps every security price stored before it, and lets an outside close in beside them', async () => {
    const { createDatabase, MIGRATIONS, migrate } = await import('../src/index');
    const { createNodeExecutor } = await import('../src/node');
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((m) => m.version < 62));
    const ows = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const account = await createAccount(older, ows, { name: 'BBCA', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await linkHolding(older, ows, { accountId: account.id, security: { ticker: 'BBCA', name: 'BBCA', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' } });
    const [security] = await listSecurities(older, ows);
    await upsertSecurityPrice(older, ows, { securityId: security!.id, onDate: '2026-09-11', priceMicro: idr(9_775) });
    expect(await migrate(older)).toContain(62);
    expect(await listPrices(older, ows, account.id)).toEqual([{ onDate: '2026-09-11', priceMicro: idr(9_775), source: 'manual' }]);
    await recordListedClose(older, ows, { securityId: security!.id, onDate: '2026-09-29', priceMicro: idr(6_150), source: 'idx' });
    expect((await listPrices(older, ows, account.id)).map((row) => row.source)).toEqual(['idx', 'manual']);
    // Running it again changes nothing.
    await older.execScript(MIGRATIONS.find((m) => m.version === 62)!.sql);
    expect((await listPrices(older, ows, account.id)).map((row) => row.source)).toEqual(['idx', 'manual']);
  });
});
