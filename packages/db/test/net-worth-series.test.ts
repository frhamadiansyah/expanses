import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  netWorthSeries,
  recordTrade,
  recordValuation,
  saveAssetProfile,
  sheetInputsAt,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-12';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let gold: AccountRow;
let house: AccountRow;
let card: AccountRow;
let kpr: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  house = await createAccount(database, ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 1_150_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 14_820_000, openedOn: '2026-01-01' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 742_300_000, openedOn: '2026-01-01' });
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

const opening = 50_000_000 + 1_150_000_000 - 14_820_000 - 742_300_000;

describe('netWorthSeries', () => {
  it('gives one point per month, oldest first', async () => {
    const points = await netWorthSeries(database, ws, ['2026-01', '2026-02', '2026-03'], {}, TODAY);
    expect(points.map((point) => point.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(points.map((point) => point.onDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('uses today for the month we are in', async () => {
    const points = await netWorthSeries(database, ws, ['2026-08', '2026-09'], {}, TODAY);
    expect(points[1]!.onDate).toBe(TODAY);
  });

  it('shows nothing before the first transaction', async () => {
    const points = await netWorthSeries(database, ws, ['2025-12'], {}, TODAY);
    expect(points[0]).toMatchObject({ assetsMinor: 0, liabilitiesMinor: 0, netWorthMinor: 0 });
  });

  it('leaves net worth alone when money simply moves into gold', async () => {
    const points = await netWorthSeries(database, ws, ['2026-02', '2026-03'], {}, TODAY);
    expect(points[0]!.netWorthMinor).toBe(opening);
    expect(points[1]!.netWorthMinor).toBe(opening);
  });

  it('moves net worth by the price difference once a price is typed', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-03-31', priceMicro: 1_900_000_000_000 });

    const points = await netWorthSeries(database, ws, ['2026-02', '2026-03'], {}, TODAY);
    expect(points[1]!.netWorthMinor! - points[0]!.netWorthMinor!).toBe(19_000_000 - 18_600_000);
  });

  it('does not let a price typed today change an earlier month', async () => {
    const before = await netWorthSeries(database, ws, ['2026-03'], {}, TODAY);
    await upsertPrice(database, ws, { accountId: gold.id, onDate: TODAY, priceMicro: 1_842_000_000_000 });

    const after = await netWorthSeries(database, ws, ['2026-03'], {}, TODAY);
    expect(after[0]!.netWorthMinor).toBe(before[0]!.netWorthMinor);
  });
});

describe('netWorthSeries with a currency it has no rate for', () => {
  it('flags every point instead of counting the foreign money as 0', async () => {
    await createAccount(database, ws, { name: 'Jenius USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
    const [point] = await netWorthSeries(database, ws, ['2026-03'], {}, TODAY);
    expect(point).toMatchObject({ month: '2026-03', assetsMinor: null, netWorthMinor: null, missing: ['USD'] });
    const [priced] = await netWorthSeries(database, ws, ['2026-03'], { USD: 16_250 }, TODAY);
    expect(priced!.missing).toEqual([]);
    expect(priced!.netWorthMinor).toBe(opening + 16_250_000);
  });
});

describe('sheetInputsAt with a currency it has no rate for', () => {
  it('names the missing rate beside the rows it could not convert', async () => {
    await createAccount(database, ws, { name: 'Jenius USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
    expect((await sheetInputsAt(database, ws, TODAY, {})).missing).toEqual(['USD']);
    expect((await sheetInputsAt(database, ws, TODAY, { USD: 16_250 })).missing).toEqual([]);
  });
});

describe('an empty account in a currency with no rate', () => {
  it('stops neither net worth nor the balance sheet: zero is zero in any currency', async () => {
    await createAccount(database, ws, { name: 'Empty USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    await createAccount(database, ws, { name: 'Empty yen card', kind: 'liability', subtype: 'credit_card', currency: 'JPY' });
    const [point] = await netWorthSeries(database, ws, ['2026-03'], {}, TODAY);
    expect(point).toMatchObject({ netWorthMinor: opening, missing: [] });
    expect((await sheetInputsAt(database, ws, TODAY, {})).missing).toEqual([]);
  });
});

describe('sheetInputsAt', () => {
  it('returns assets with their group and what they are worth', async () => {
    await recordValuation(database, ws, { accountId: house.id, asOf: '2026-01-15', valueMinor: 1_420_000_000, basis: 'appraisal' });

    const sheet = await sheetInputsAt(database, ws, TODAY);
    expect(sheet.assets.find((asset) => asset.accountId === bca.id)).toMatchObject({ planGroup: 'liquid', valueMinor: 50_000_000 - 18_600_000 });
    expect(sheet.assets.find((asset) => asset.accountId === house.id)).toMatchObject({ planGroup: 'use', valueMinor: 1_420_000_000, name: 'House in Bintaro' });
    expect(sheet.assets.find((asset) => asset.accountId === gold.id)).toMatchObject({ planGroup: 'invest' });
  });

  it('gives debts as positive amounts', async () => {
    const sheet = await sheetInputsAt(database, ws, TODAY);
    expect(sheet.liabilities.find((debt) => debt.accountId === card.id)).toMatchObject({ balanceMinor: 14_820_000, subtype: 'credit_card' });
    expect(sheet.liabilities.find((debt) => debt.accountId === kpr.id)).toMatchObject({ balanceMinor: 742_300_000, subtype: 'loan' });
  });

  it('treats a card as due within a year, and a loan with no terms as wholly due', async () => {
    const sheet = await sheetInputsAt(database, ws, TODAY);
    expect(sheet.liabilities.find((debt) => debt.accountId === card.id)!.dueWithinYearMinor).toBe(14_820_000);
    // Without terms there is no schedule to read, so nothing can be called long-term yet.
    // Once the loan has terms, only its next twelve months of principal fall within the year.
    expect(sheet.liabilities.find((debt) => debt.accountId === kpr.id)!.dueWithinYearMinor).toBe(742_300_000);
  });

  it('leaves out debts that are paid off', async () => {
    const spare = await createAccount(database, ws, { name: 'Paid card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const sheet = await sheetInputsAt(database, ws, TODAY);
    expect(sheet.liabilities.find((debt) => debt.accountId === spare.id)).toBeUndefined();
  });
});
