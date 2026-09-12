import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  assetValuesAt,
  createAccount,
  type Database,
  monthEndValues,
  netWorthAt,
  recordTrade,
  recordValuation,
  saveAssetProfile,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let gold: AccountRow;
let bca: AccountRow;
let house: AccountRow;
let card: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  house = await createAccount(database, ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 1_150_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 14_820_000, openedOn: '2026-01-01' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  await saveAssetProfile(database, ws, { accountId: house.id, assetKind: 'property' });
  await recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn: '2026-03-09',
    unitsMicro: 10_000_000,
    grossMinor: 18_600_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: bca.id,
  });
});

const valueOf = (rows: Awaited<ReturnType<typeof assetValuesAt>>, accountId: string) => rows.find((row) => row.accountId === accountId)!;

describe('assetValuesAt', () => {
  it('uses ledger balances for bank accounts and units times price for holdings', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });

    const rows = await assetValuesAt(database, ws, '2026-09-12');
    expect(valueOf(rows, bca.id)).toMatchObject({ valueMinor: 50_000_000 - 18_600_000, source: 'ledger', planGroup: 'liquid', name: 'BCA Tahapan' });
    expect(valueOf(rows, gold.id)).toMatchObject({ valueMinor: 18_420_000, costMinor: 18_600_000, source: 'price', planGroup: 'invest', stale: false });
  });

  it('falls back to cost and marks a holding with no price', async () => {
    const rows = await assetValuesAt(database, ws, '2026-09-12');
    expect(valueOf(rows, gold.id)).toMatchObject({ valueMinor: 18_600_000, source: 'cost', stale: true });
  });

  it('uses the latest estimate for property and marks it stale after a year', async () => {
    await recordValuation(database, ws, { accountId: house.id, asOf: '2025-01-15', valueMinor: 1_380_000_000, basis: 'appraisal' });

    const rows = await assetValuesAt(database, ws, '2026-09-12');
    expect(valueOf(rows, house.id)).toMatchObject({ valueMinor: 1_380_000_000, source: 'valuation', planGroup: 'use', stale: true });
  });

  it('marks a price older than 30 days', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-08-01', priceMicro: 1_815_000_000_000 });

    const rows = await assetValuesAt(database, ws, '2026-09-12');
    expect(valueOf(rows, gold.id).stale).toBe(true);
  });

  it('leaves liabilities out', async () => {
    const rows = await assetValuesAt(database, ws, '2026-09-12');
    expect(rows.find((row) => row.accountId === card.id)).toBeUndefined();
  });
});

describe('netWorthAt', () => {
  it('adds assets, subtracts what is owed', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });

    const result = await netWorthAt(database, ws, '2026-09-12', {});
    expect(result.assetsMinor).toBe(50_000_000 - 18_600_000 + 18_420_000 + 1_150_000_000);
    expect(result.liabilitiesMinor).toBe(14_820_000);
    expect(result.netWorthMinor).toBe(result.assetsMinor - result.liabilitiesMinor);
  });

  it('converts an account in another currency at the rate given', async () => {
    const jenius = await createAccount(database, ws, { name: 'Jenius USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 125_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });

    const result = await netWorthAt(database, ws, '2026-09-12', { USD: 16_250 });
    const withoutUsd = await netWorthAt(database, ws, '2026-09-12', { USD: 0.000_001 });
    expect(result.assetsMinor - withoutUsd.assetsMinor).toBe(20_312_500);
    expect(jenius.currency).toBe('USD');
  });

  it('ignores trades and prices dated after the day asked for', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-11', priceMicro: 1_842_000_000_000 });

    const result = await netWorthAt(database, ws, '2026-02-28', {});
    expect(result.assetsMinor).toBe(50_000_000 + 1_150_000_000);
  });
});

describe('monthEndValues', () => {
  it('returns one value per month, in order', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-04-30', priceMicro: 1_800_000_000_000 });
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-05-31', priceMicro: 1_842_000_000_000 });

    const values = await monthEndValues(database, ws, gold.id, ['2026-02', '2026-03', '2026-04', '2026-05']);
    expect(values).toEqual([0, 18_600_000, 18_000_000, 18_420_000]);
  });
});
