import { beforeEach, describe, expect, it } from 'vitest';
import { type AccountRow, createAccount, createWorkspace, type Database, listPrices, listValuations, recordValuation, upsertPrice, type WorkspaceContext } from '../src/index';
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

describe('prices', () => {
  it('keeps one price per date and replaces it when typed again', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_800_000_000_000 });
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });

    const prices = await listPrices(database, ws, gold.id);
    expect(prices).toEqual([{ onDate: '2026-09-11', priceMicro: 1_842_000_000_000 }]);
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
