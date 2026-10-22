import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  deleteTrade,
  goalContributionsFor,
  goalLinksFor,
  listEarmarks,
  listTrades,
  migrate,
  MIGRATIONS,
  createDatabase,
  createWorkspace,
  recordTrade,
  replaceTrade,
  resplitTrade,
  retagTrade,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const TODAY = '2026-10-22';
const g = (grams: number) => grams * 1_000_000;

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let gold: AccountRow;
let emergency: string;
let education: string;

const goal = (name: string) => saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'All of it', targetMinor: 100_000_000, targetMonths: null, dueOn: '2030-12-31' }] });

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  await upsertPrice(database, ws, { accountId: gold.id, onDate: TODAY, priceMicro: 2_000_000_000_000 });
  emergency = await goal('Emergency fund');
  education = await goal('Education fund');
});

// 8 g at Rp1.900.000 with Rp80.000 of fee: Rp15.280.000 out of BCA.
const buyEight = (extra: object = {}) =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn: '2026-10-20',
    unitsMicro: g(8),
    grossMinor: 15_200_000,
    feeMinor: 80_000,
    taxMinor: 0,
    cashAccountId: bca.id,
    goalParts: [
      { goalId: emergency, unitsMicro: g(5), moneyMinor: 0 },
      { goalId: education, unitsMicro: g(3), moneyMinor: 0 },
    ],
    ...extra,
  });

describe('a buy split between goals (0083)', () => {
  it('is one trade and one cash payment, and each goal holds its grams', async () => {
    await buyEight();
    const trades = await listTrades(database, ws);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ goalId: null, goalParts: [{ goalId: emergency, unitsMicro: g(5) }, { goalId: education, unitsMicro: g(3) }] });
    const links = await goalLinksFor(database, ws, TODAY);
    expect(links.find((link) => link.goalId === emergency)).toMatchObject({ unitsMicro: g(5), valueMinor: 10_000_000 });
    expect(links.find((link) => link.goalId === education)).toMatchObject({ unitsMicro: g(3), valueMinor: 6_000_000 });
  });

  it('one part that takes the whole buy is saved as that one goal', async () => {
    await buyEight({ goalParts: [{ goalId: emergency, unitsMicro: g(8), moneyMinor: 0 }] });
    expect((await listTrades(database, ws))[0]).toMatchObject({ goalId: emergency });
    expect((await listTrades(database, ws))[0]!.goalParts).toBeUndefined();
  });

  it('refuses parts that take more than the buy', async () => {
    await expect(
      buyEight({ goalParts: [{ goalId: emergency, unitsMicro: g(5), moneyMinor: 0 }, { goalId: education, unitsMicro: g(4), moneyMinor: 0 }] }),
    ).rejects.toThrow(/more than this trade/);
    expect(await listTrades(database, ws)).toHaveLength(0);
  });

  it('lowers each goal’s set-aside by its share of what left the account, and a delete gives it back', async () => {
    await saveEarmark(database, ws, { goalId: emergency, accountId: bca.id, amountMinor: 20_000_000 });
    await saveEarmark(database, ws, { goalId: education, accountId: bca.id, amountMinor: 20_000_000 });
    const { tradeId } = await buyEight();
    const left = async () => Object.fromEntries((await listEarmarks(database, ws)).map((row) => [row.goalId, row.amountMinor]));
    // Rp15.280.000 shared 5 : 3 — Rp9.550.000 and Rp5.730.000.
    expect(await left()).toEqual({ [emergency]: 10_450_000, [education]: 14_270_000 });
    await deleteTrade(database, ws, tradeId);
    expect(await left()).toEqual({ [emergency]: 20_000_000, [education]: 20_000_000 });
  });

  it('counts each goal’s share in the month’s contributions', async () => {
    await buyEight();
    expect(await goalContributionsFor(database, ws, '2026-10')).toMatchObject({ [emergency]: 9_550_000, [education]: 5_730_000 });
  });

  it('a split sell takes from each goal, and refuses a part its goal does not hold', async () => {
    await buyEight();
    const sell = (parts: { goalId: string; grams: number }[], grams: number) =>
      recordTrade(database, ws, {
        accountId: gold.id,
        kind: 'sell',
        occurredOn: '2026-10-21',
        unitsMicro: g(grams),
        grossMinor: grams * 2_000_000,
        feeMinor: 0,
        taxMinor: 0,
        cashAccountId: bca.id,
        goalParts: parts.map((part) => ({ goalId: part.goalId, unitsMicro: g(part.grams), moneyMinor: 0 })),
      });
    await expect(sell([{ goalId: education, grams: 4 }], 4)).rejects.toThrow(/Education fund holds 3/);
    await sell([{ goalId: emergency, grams: 2 }, { goalId: education, grams: 1 }], 3);
    const links = await goalLinksFor(database, ws, TODAY);
    expect(links.find((link) => link.goalId === emergency)!.unitsMicro).toBe(g(3));
    expect(links.find((link) => link.goalId === education)!.unitsMicro).toBe(g(2));
  });

  it('an edit carries the split it is given, and the set-aside follows', async () => {
    await saveEarmark(database, ws, { goalId: emergency, accountId: bca.id, amountMinor: 20_000_000 });
    const { tradeId } = await buyEight();
    await replaceTrade(database, ws, tradeId, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: '2026-10-20',
      unitsMicro: g(8),
      grossMinor: 15_200_000,
      feeMinor: 80_000,
      taxMinor: 0,
      cashAccountId: bca.id,
      goalParts: [
        { goalId: emergency, unitsMicro: g(4), moneyMinor: 0 },
        { goalId: education, unitsMicro: g(4), moneyMinor: 0 },
      ],
    });
    const trade = (await listTrades(database, ws))[0]!;
    expect(trade.goalParts).toEqual([
      { goalId: emergency, unitsMicro: g(4), moneyMinor: 0 },
      { goalId: education, unitsMicro: g(4), moneyMinor: 0 },
    ]);
    // Half of Rp15.280.000 is the emergency fund's now.
    expect((await listEarmarks(database, ws)).find((row) => row.goalId === emergency)!.amountMinor).toBe(12_360_000);
  });

  it('re-splits in place, refuses one that leaves a later sell short, and a retag clears the split', async () => {
    const { tradeId } = await buyEight();
    await resplitTrade(database, ws, tradeId, [
      { goalId: emergency, unitsMicro: g(2), moneyMinor: 0 },
      { goalId: education, unitsMicro: g(6), moneyMinor: 0 },
    ]);
    expect((await listTrades(database, ws))[0]!.goalParts).toEqual([
      { goalId: emergency, unitsMicro: g(2), moneyMinor: 0 },
      { goalId: education, unitsMicro: g(6), moneyMinor: 0 },
    ]);
    await recordTrade(database, ws, { accountId: gold.id, kind: 'sell', occurredOn: '2026-10-21', unitsMicro: g(5), grossMinor: 10_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id, goalId: education });
    await expect(
      resplitTrade(database, ws, tradeId, [
        { goalId: emergency, unitsMicro: g(5), moneyMinor: 0 },
        { goalId: education, unitsMicro: g(3), moneyMinor: 0 },
      ]),
    ).rejects.toThrow(/already sold/);
    await retagTrade(database, ws, tradeId, education);
    const trade = (await listTrades(database, ws)).find((row) => row.id === tradeId)!;
    expect(trade.goalId).toBe(education);
    expect(trade.goalParts).toBeUndefined();
  });
});

describe('a fund tracked by money, split by amount', () => {
  it('puts each goal’s amount in', async () => {
    const fund = await createAccount(database, ws, { name: 'Money market fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: fund.id, assetKind: 'fund', valuationMode: 'amount' } as never);
    await recordTrade(database, ws, {
      accountId: fund.id,
      kind: 'buy',
      occurredOn: '2026-10-01',
      unitsMicro: 0,
      grossMinor: 1_000_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: bca.id,
      goalParts: [
        { goalId: emergency, unitsMicro: 0, moneyMinor: 600_000 },
        { goalId: education, unitsMicro: 0, moneyMinor: 400_000 },
      ],
    });
    const links = await goalLinksFor(database, ws, TODAY);
    expect(links.find((link) => link.goalId === emergency && link.accountId === fund.id)).toMatchObject({ moneyMinor: 600_000 });
    expect(links.find((link) => link.goalId === education && link.accountId === fund.id)).toMatchObject({ moneyMinor: 400_000 });
  });
});

describe('on a database from before 0083', () => {
  it('lists trades as before, and refuses a split it has nowhere to keep', async () => {
    const executor = createNodeExecutor();
    const old = createDatabase(executor);
    await migrate(old, MIGRATIONS.filter((m) => m.version < 83));
    const oldWs = await createWorkspace(old, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bank = await createAccount(old, oldWs, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
    const bars = await createAccount(old, oldWs, { name: 'Bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(old, oldWs, { accountId: bars.id, assetKind: 'gold' });
    const a = await saveGoal(old, oldWs, { name: 'A', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2030-01-01' }] });
    const b = await saveGoal(old, oldWs, { name: 'B', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'x', targetMinor: 1, targetMonths: null, dueOn: '2030-01-01' }] });
    await recordTrade(old, oldWs, { accountId: bars.id, kind: 'buy', occurredOn: '2026-10-01', unitsMicro: g(1), grossMinor: 1_900_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id, goalId: a });
    expect(await listTrades(old, oldWs)).toHaveLength(1);
    await expect(
      recordTrade(old, oldWs, {
        accountId: bars.id, kind: 'buy', occurredOn: '2026-10-02', unitsMicro: g(2), grossMinor: 3_800_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id,
        goalParts: [{ goalId: a, unitsMicro: g(1), moneyMinor: 0 }, { goalId: b, unitsMicro: g(1), moneyMinor: 0 }],
      }),
    ).rejects.toThrow(/before a purchase could be split/);
    executor.close();
  });
});
