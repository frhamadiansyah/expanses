import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  archiveAccount,
  assetSaleOf,
  assetValuesAt,
  checkLedgerIntegrity,
  coretaxInputsFor,
  createAccount,
  type Database,
  goneAssets,
  listTransactions,
  monthEndValues,
  nativeBalances,
  netWorthAt,
  netWorthSeries,
  recordValuation,
  restoreAsset,
  saleFigures,
  saveAcquired,
  saveAssetProfile,
  saveGoal,
  sellAsset,
  setAsideView,
  undoSale,
  voidTransaction,
  replaceTransaction,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let car: AccountRow;
let bank: AccountRow;

const TODAY = '2026-10-26';

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2022-01-01' });
  car = await createAccount(database, ws, { name: 'Toyota Avanza', kind: 'asset', subtype: 'vehicle', currency: 'IDR', openingBalanceMinor: 210_000_000, openedOn: '2022-03-12' });
  await saveAssetProfile(database, ws, { accountId: car.id, assetKind: 'vehicle' });
  await recordValuation(database, ws, { accountId: car.id, asOf: '2026-01-01', valueMinor: 215_000_000, basis: 'estimate' });
});

const sell = (extra: Partial<Parameters<typeof sellAsset>[2]> = {}) =>
  sellAsset(database, ws, { accountId: car.id, soldOn: '2026-10-20', soldForMinor: 225_000_000, cashAccountId: bank.id, ...extra }, TODAY);

const balance = async (id: string, date?: string) => (await nativeBalances(database, ws, date))[id] ?? 0;
const worth = async (date: string) => (await netWorthAt(database, ws, date, {})).netWorthMinor;

describe('the sums', () => {
  it('total is sold for less costs, gain is the total against the original cost', () => {
    expect(saleFigures(225_000_000, 0, 210_000_000)).toEqual({ totalMinor: 225_000_000, gainMinor: 15_000_000 });
    expect(saleFigures(225_000_000, 5_000_000, 210_000_000)).toEqual({ totalMinor: 220_000_000, gainMinor: 10_000_000 });
    expect(saleFigures(200_000_000, 0, 210_000_000)).toEqual({ totalMinor: 200_000_000, gainMinor: -10_000_000 });
  });
});

describe('selling an estimated asset', () => {
  it('posts exactly the total into the account and empties the asset, with no costs', async () => {
    const sale = await sell();
    expect(sale).toMatchObject({ soldForMinor: 225_000_000, costsMinor: 0, costMinor: 210_000_000, totalMinor: 225_000_000, gainMinor: 15_000_000 });
    expect(await balance(bank.id)).toBe(50_000_000 + 225_000_000);
    expect(await balance(car.id)).toBe(0);
  });

  it('takes the costs off what reaches the account, and the gain follows', async () => {
    const sale = await sell({ costsMinor: 5_000_000 });
    expect(sale).toMatchObject({ totalMinor: 220_000_000, gainMinor: 10_000_000 });
    expect(await balance(bank.id)).toBe(50_000_000 + 220_000_000);
  });

  it('moves net worth from the last estimate to the total received', async () => {
    const before = await worth('2026-10-19');
    await sell({ costsMinor: 5_000_000 });
    // Net worth before the sale: bank 50m + the last estimate 215m. After: bank 270m. The change is the total less the estimate.
    expect(await worth('2026-10-20')).toBe(270_000_000);
    expect(before).toBe(265_000_000);
  });

  it('records a loss against the original cost, not the last estimate', async () => {
    const sale = await sell({ soldForMinor: 190_000_000 });
    expect(sale.gainMinor).toBe(-20_000_000);
    expect(await balance(bank.id)).toBe(240_000_000);
    expect(await balance(car.id)).toBe(0);
    expect((await checkLedgerIntegrity(database, ws)).length).toBe(0);
  });

  it('touches no spending or income category', async () => {
    await sell({ costsMinor: 1_000_000 });
    const sold = (await listTransactions(database, ws)).find((tx) => tx.description === 'Sold Toyota Avanza')!;
    const kinds = sold.entries.map((entry) => entry.accountKind);
    expect(kinds).not.toContain('expense');
    expect(kinds).not.toContain('income');
  });

  it('sells an asset that has no cost recorded', async () => {
    const land = await createAccount(database, ws, { name: 'Tanah', kind: 'asset', subtype: 'property', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: land.id, assetKind: 'property' });
    const sale = await sellAsset(database, ws, { accountId: land.id, soldOn: '2026-10-20', soldForMinor: 100_000_000, cashAccountId: bank.id }, TODAY);
    expect(sale).toMatchObject({ costMinor: 0, gainMinor: 100_000_000 });
    expect(await balance(bank.id)).toBe(150_000_000);
  });
});

describe('what a sale refuses', () => {
  it('a day in the future', async () => {
    await expect(sell({ soldOn: '2026-10-27' })).rejects.toThrow(/after today/);
  });

  it('a day before it was acquired', async () => {
    await expect(sell({ soldOn: '2022-03-11' })).rejects.toThrow(/before it was acquired/);
    await saveAcquired(database, ws, car.id, { on: '2024-05-01', precision: 'day' });
    await expect(sell({ soldOn: '2024-04-30' })).rejects.toThrow(/before it was acquired/);
    await expect(sell({ soldOn: '2024-05-01' })).resolves.toBeTruthy();
  });

  it('a missing price, costs that eat it, and a second sale', async () => {
    await expect(sell({ soldForMinor: 0 })).rejects.toThrow(/sold for/);
    await expect(sell({ costsMinor: 225_000_000 })).rejects.toThrow(/Costs/);
    await expect(sell({ costsMinor: -1 })).rejects.toThrow(/Costs/);
    await sell();
    await expect(sell()).rejects.toThrow(/already sold/);
  });

  it('a priced holding, an archived asset, a card, and an account in another currency', async () => {
    const gold = await createAccount(database, ws, { name: 'Emas', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    await expect(sellAsset(database, ws, { accountId: gold.id, soldOn: '2026-10-20', soldForMinor: 1, cashAccountId: bank.id }, TODAY)).rejects.toThrow(/estimate/);
    const usd = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    await expect(sell({ cashAccountId: usd.id })).rejects.toThrow(/does not hold IDR/);
    const card = await createAccount(database, ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(sell({ cashAccountId: card.id })).rejects.toThrow(/money account/);
    await expect(sell({ cashAccountId: car.id })).rejects.toThrow(/money account/);
  });

  it('an asset in another currency needs the rate for the day, and sells into an account holding it', async () => {
    const bike = await createAccount(database, ws, { name: 'Motor', kind: 'asset', subtype: 'vehicle', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2025-01-01', openingRateToBase: 16_000 });
    await saveAssetProfile(database, ws, { accountId: bike.id, assetKind: 'vehicle' });
    const usd = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' });
    await expect(sellAsset(database, ws, { accountId: bike.id, soldOn: '2026-10-20', soldForMinor: 120_000, cashAccountId: usd.id }, TODAY)).rejects.toThrow(/rate/);
    const sale = await sellAsset(database, ws, { accountId: bike.id, soldOn: '2026-10-20', soldForMinor: 120_000, cashAccountId: usd.id, rateToBase: 16_500 }, TODAY);
    expect(sale.gainMinor).toBe(20_000);
    expect(await balance(usd.id)).toBe(120_000);
    expect(await balance(bike.id)).toBe(0);
  });
});

describe('undoing a sale', () => {
  it('leaves every balance, net worth, the series and the asset as before', async () => {
    const before = {
      balances: await nativeBalances(database, ws),
      worth: await worth(TODAY),
      row: (await assetValuesAt(database, ws, TODAY)).find((row) => row.accountId === car.id),
    };
    await sell({ costsMinor: 2_000_000 });
    expect(await worth(TODAY)).not.toBe(before.worth);
    await undoSale(database, ws, car.id);
    expect(await nativeBalances(database, ws)).toEqual(before.balances);
    expect(await worth(TODAY)).toBe(before.worth);
    expect((await assetValuesAt(database, ws, TODAY)).find((row) => row.accountId === car.id)).toEqual(before.row);
    expect(await assetSaleOf(database, ws, car.id)).toBeNull();
    expect((await checkLedgerIntegrity(database, ws)).length).toBe(0);
    // And it can be sold again.
    await expect(sell()).resolves.toBeTruthy();
  });

  it('refuses when the asset is not sold', async () => {
    await expect(undoSale(database, ws, car.id)).rejects.toThrow(/not sold/);
  });

  it('the money in cannot be deleted or edited from anywhere but Undo sale', async () => {
    const sale = await sell();
    await expect(voidTransaction(database, ws, sale.transactionId)).rejects.toThrow(/Undo sale/);
    await expect(
      replaceTransaction(database, ws, sale.transactionId, { occurredOn: '2026-10-20', description: 'x', lines: [] }),
    ).rejects.toThrow(/Undo sale/);
  });
});

describe('net worth and the lists after the sale day', () => {
  it('counts the asset until the day it was sold and not from it', async () => {
    await sell(); // 2026-10-20, for 225m
    expect((await assetValuesAt(database, ws, '2026-10-19')).some((row) => row.accountId === car.id)).toBe(true);
    expect((await assetValuesAt(database, ws, '2026-10-20')).some((row) => row.accountId === car.id)).toBe(false);
    expect((await assetValuesAt(database, ws, TODAY)).some((row) => row.accountId === car.id)).toBe(false);
    expect(await worth('2026-10-19')).toBe(50_000_000 + 215_000_000);
    expect(await worth('2026-10-20')).toBe(50_000_000 + 225_000_000);
  });

  it('keeps the history before the sale in the series and the asset own chart', async () => {
    await sell();
    const series = await netWorthSeries(database, ws, ['2026-09', '2026-10'], {}, TODAY);
    expect(series.map((point) => point.netWorthMinor)).toEqual([265_000_000, 275_000_000]);
    expect(await monthEndValues(database, ws, car.id, ['2026-09', '2026-10'])).toEqual([215_000_000, 0]);
  });

  it('is left out of the totals once sold', async () => {
    const before = (await assetValuesAt(database, ws, TODAY)).reduce((sum, row) => sum + row.valueMinor, 0);
    await sell();
    const after = (await assetValuesAt(database, ws, TODAY)).reduce((sum, row) => sum + row.valueMinor, 0);
    expect(before - after).toBe(215_000_000 - 225_000_000);
  });
});

describe('the tax report year-end list', () => {
  const listed = async (year: number) => (await coretaxInputsFor(database, ws, year)).estimated.some((row) => row.accountId === car.id);

  it('lists the asset for years it was held at 31 December, and not for the sale year or later', async () => {
    expect(await listed(2025)).toBe(true);
    expect(await listed(2026)).toBe(true);
    await sell(); // sold 20 Oct 2026
    expect(await listed(2025)).toBe(true);
    expect(await listed(2026)).toBe(false);
    expect(await listed(2027)).toBe(false);
    await undoSale(database, ws, car.id);
    expect(await listed(2026)).toBe(true);
  });
});

describe('goal', () => {
  it('sets the total aside for the goal on the account, and Undo sale takes it back', async () => {
    const goal = await saveGoal(database, ws, { name: 'House fund', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'Deposit', targetMinor: 500_000_000, targetMonths: null, dueOn: '2030-01-01' }] });
    const id = typeof goal === 'string' ? goal : (goal as { id: string }).id;
    await sell({ goalId: id });
    const view = await setAsideView(database, ws, bank.id);
    expect(view?.setAsideMinor).toBe(225_000_000);
    await undoSale(database, ws, car.id);
    const after = await setAsideView(database, ws, bank.id);
    expect(after?.setAsideMinor ?? 0).toBe(0);
  });

  it('refuses a goal that is not here', async () => {
    await expect(sell({ goalId: 'nope' })).rejects.toThrow(/Goal not found/);
  });
});

describe('sold and archived assets', () => {
  it('lists a sold asset at its price and an archived one at its last estimate; neither counts', async () => {
    const vario = await createAccount(database, ws, { name: 'Honda Vario', kind: 'asset', subtype: 'vehicle', currency: 'IDR', openingBalanceMinor: 18_000_000, openedOn: '2019-01-01' });
    await saveAssetProfile(database, ws, { accountId: vario.id, assetKind: 'vehicle' });
    await recordValuation(database, ws, { accountId: vario.id, asOf: '2025-01-01', valueMinor: 14_200_000, basis: 'estimate' });
    await recordValuation(database, ws, { accountId: vario.id, asOf: '2025-06-01', valueMinor: 13_000_000, basis: 'njop' });
    // Archiving wants the balance at zero: the cost is taken away first.
    const { changeOriginalCost } = await import('../src/index');
    await changeOriginalCost(database, ws, vario.id, 0, TODAY);
    await archiveAccount(database, ws, vario.id);
    await sell();
    const gone = await goneAssets(database, ws);
    expect(gone.map((row) => [row.name, row.status, row.figureMinor])).toEqual([
      ['Honda Vario', 'archived', 14_200_000],
      ['Toyota Avanza', 'sold', 225_000_000],
    ]);
    const live = await assetValuesAt(database, ws, TODAY);
    expect(live.map((row) => row.name)).not.toContain('Honda Vario');
    expect(live.map((row) => row.name)).not.toContain('Toyota Avanza');
  });

  it('restores an archived asset to the list, and refuses one that is not archived', async () => {
    await expect(restoreAsset(database, ws, car.id)).rejects.toThrow(/not archived/);
    const { changeOriginalCost } = await import('../src/index');
    await changeOriginalCost(database, ws, car.id, 0, TODAY);
    await archiveAccount(database, ws, car.id);
    expect((await assetValuesAt(database, ws, TODAY)).some((row) => row.accountId === car.id)).toBe(false);
    await restoreAsset(database, ws, car.id);
    expect((await assetValuesAt(database, ws, TODAY)).some((row) => row.accountId === car.id)).toBe(true);
    expect(await goneAssets(database, ws)).toEqual([]);
  });
});
