import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  createWorkspace,
  type Database,
  goldPriceChoiceOf,
  listPrices,
  listValuations,
  recordValuation,
  recordWorldPrice,
  setGoldPriceChoice,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let gold: AccountRow;
let house: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  house = await createAccount(database, ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR' });
});

describe('the world gold price', () => {
  it('is kept as the day’s price, marked as fetched, and a later fetch that day replaces it', async () => {
    await recordWorldPrice(database, ws, { accountId: gold.id, onDate: '2026-09-30', priceMicro: 2_399_717_191_745 });
    await recordWorldPrice(database, ws, { accountId: gold.id, onDate: '2026-09-30', priceMicro: 2_400_000_000_000 });
    expect(await listPrices(database, ws, gold.id)).toEqual([{ onDate: '2026-09-30', priceMicro: 2_400_000_000_000, source: 'world' }]);
  });

  it('never overwrites a price typed for that day, and a typed price replaces a fetched one', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-30', priceMicro: 2_485_000_000_000 });
    await recordWorldPrice(database, ws, { accountId: gold.id, onDate: '2026-09-30', priceMicro: 2_399_717_191_745 });
    expect(await listPrices(database, ws, gold.id)).toEqual([{ onDate: '2026-09-30', priceMicro: 2_485_000_000_000, source: 'manual' }]);

    await recordWorldPrice(database, ws, { accountId: gold.id, onDate: '2026-10-01', priceMicro: 2_399_717_191_745 });
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-10-01', priceMicro: 2_490_000_000_000 });
    expect((await listPrices(database, ws, gold.id))[0]).toEqual({ onDate: '2026-10-01', priceMicro: 2_490_000_000_000, source: 'manual' });
  });

  it('follows the world price until told to take only typed prices, keeping the prices it has', async () => {
    expect(await goldPriceChoiceOf(database, ws, gold.id)).toBe('world');
    await recordWorldPrice(database, ws, { accountId: gold.id, onDate: '2026-09-30', priceMicro: 2_399_717_191_745 });
    await setGoldPriceChoice(database, ws, gold.id, 'typed');
    expect(await goldPriceChoiceOf(database, ws, gold.id)).toBe('typed');
    expect(await listPrices(database, ws, gold.id)).toHaveLength(1);
    await setGoldPriceChoice(database, ws, gold.id, 'world');
    expect(await goldPriceChoiceOf(database, ws, gold.id)).toBe('world');
  });
});

describe('prices', () => {
  it('keeps one price per date and replaces it when typed again', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_800_000_000_000 });
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });

    const prices = await listPrices(database, ws, gold.id);
    expect(prices).toEqual([{ onDate: '2026-09-11', priceMicro: 1_842_000_000_000, source: 'manual' }]);
  });

  it('lists newest first', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-08-31', priceMicro: 1_815_000_000_000 });
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });

    const prices = await listPrices(database, ws, gold.id);
    expect(prices.map((p) => p.onDate)).toEqual(['2026-09-11', '2026-08-31']);
  });

  it('refuses a negative price', async () => {
    await expect(upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: -1 })).rejects.toThrow();
  });

  it('refuses an asset from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(upsertPrice(database, other, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1 })).rejects.toThrow();
  });
});

describe('valuations', () => {
  it('keeps every estimate so the history stays', async () => {
    await recordValuation(database, ws, { accountId: house.id, asOf: '2025-10-01', valueMinor: 1_380_000_000, basis: 'listing' });
    await recordValuation(database, ws, { accountId: house.id, asOf: '2026-01-15', valueMinor: 1_420_000_000, basis: 'appraisal', note: 'Bank top-up offer' });
    await recordValuation(database, ws, { accountId: house.id, asOf: '2026-05-20', valueMinor: 905_000_000, basis: 'njop' });

    const rows = await listValuations(database, ws, house.id);
    expect(rows.map((v) => v.asOf)).toEqual(['2026-05-20', '2026-01-15', '2025-10-01']);
    expect(rows[1]).toMatchObject({ valueMinor: 1_420_000_000, basis: 'appraisal', note: 'Bank top-up offer' });
  });

  it('refuses an unknown basis', async () => {
    await expect(
      // @ts-expect-error the basis must be one of the known ones
      recordValuation(database, ws, { accountId: house.id, asOf: '2026-01-15', valueMinor: 1, basis: 'guess' }),
    ).rejects.toThrow();
  });

  it('refuses an asset from another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(recordValuation(database, other, { accountId: house.id, asOf: '2026-01-15', valueMinor: 1, basis: 'estimate' })).rejects.toThrow();
  });
});

describe('migration 0060', () => {
  it('keeps every price stored before it, and lets a fetched one in beside them', async () => {
    const { createDatabase, MIGRATIONS, migrate } = await import('../src/index');
    const { createNodeExecutor } = await import('../src/node');
    const older = createDatabase(createNodeExecutor());
    await migrate(older, MIGRATIONS.filter((m) => m.version < 60));
    const ows = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bar = await createAccount(older, ows, { name: 'Gold', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await upsertPrice(older, ows, { accountId: bar.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });
    expect(await migrate(older)).toContain(60);
    expect(await listPrices(older, ows, bar.id)).toEqual([{ onDate: '2026-09-11', priceMicro: 1_842_000_000_000, source: 'manual' }]);
    await recordWorldPrice(older, ows, { accountId: bar.id, onDate: '2026-09-30', priceMicro: 2_399_717_191_745 });
    expect((await listPrices(older, ows, bar.id)).map((row) => row.source)).toEqual(['world', 'manual']);
  });
});
