import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  assetValuesAt,
  checkLedgerIntegrity,
  coretaxInputsFor,
  createAccount,
  type Database,
  listTrades,
  nativeBalances,
  positionsFor,
  recordTrade,
  recordValuation,
  replaceTrade,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let fund: AccountRow;
let bank: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  fund = await createAccount(database, ws, { name: 'Sucor Money Market', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: fund.id, assetKind: 'fund' });
  bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
});

const money = (kind: 'buy' | 'sell', occurredOn: string, grossMinor: number) =>
  recordTrade(database, ws, { accountId: fund.id, kind, occurredOn, unitsMicro: 0, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });

const valueOn = async (date: string) => (await assetValuesAt(database, ws, date)).find((row) => row.accountId === fund.id)!;

/** The owner's example: 1.000.000 in, Bibit says 1.052.000, 500.000 more, then half the value out. */
async function ownersExample() {
  await money('buy', '2026-08-01', 1_000_000);
  await recordValuation(database, ws, { accountId: fund.id, asOf: '2026-10-01', valueMinor: 1_052_000, basis: 'estimate' });
  await money('buy', '2026-10-05', 500_000);
}

describe('a fund tracked by money, saved', () => {
  it('buys with no units, and is worth the typed value moved by the buy after it', async () => {
    await ownersExample();
    expect(await valueOn('2026-10-05')).toMatchObject({ mode: 'amount', valueMinor: 1_552_000, costMinor: 1_500_000, source: 'valuation' });
    expect((await nativeBalances(database, ws))[bank.id]).toBe(10_000_000 - 1_500_000);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('sells half the value, takes half the money, books the rest as profit, and keeps that cost with the sell', async () => {
    await ownersExample();
    await money('sell', '2026-10-10', 776_000);

    expect(await valueOn('2026-10-10')).toMatchObject({ valueMinor: 776_000, costMinor: 750_000 });
    expect((await positionsFor(database, ws))[fund.id]).toMatchObject({ costMinor: 750_000, realizedMinor: 26_000 });
    expect((await listTrades(database, ws)).find((trade) => trade.kind === 'sell')?.basisMinor).toBe(750_000);
    // The holding gave up 750.000 and the bank got 776.000: the ledger's balance on the fund is the money still in.
    expect((await nativeBalances(database, ws))[fund.id]).toBe(750_000);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('never re-books a sell’s profit when an earlier buy is changed', async () => {
    await ownersExample();
    await money('sell', '2026-10-10', 776_000);
    const first = (await listTrades(database, ws)).find((trade) => trade.occurredOn === '2026-08-01')!;

    const result = await replaceTrade(database, ws, first.id, {
      accountId: fund.id, kind: 'buy', occurredOn: '2026-08-01', unitsMicro: 0, grossMinor: 1_200_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id,
    });

    expect(result.recalculatedSells).toEqual([]);
    expect((await listTrades(database, ws)).find((trade) => trade.kind === 'sell')?.basisMinor).toBe(750_000);
    expect((await positionsFor(database, ws))[fund.id]).toMatchObject({ costMinor: 950_000, realizedMinor: 26_000 });
  });

  it('files its year-end value on the tax report with no units', async () => {
    await ownersExample();
    const inputs = await coretaxInputsFor(database, ws, 2026);
    const row = inputs.holdings.find((holding) => holding.accountId === fund.id);
    expect(row).toMatchObject({ code: '0307', valueMinor: 1_552_000 });
    expect(row!.byYear['2026']).toMatchObject({ costMinor: 1_500_000 });
  });

  it('keeps a fund from the units days valued at its last NAV until a value is typed', async () => {
    await recordTrade(database, ws, { accountId: fund.id, kind: 'buy', occurredOn: '2025-03-01', unitsMicro: 1_000_000_000, grossMinor: 1_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });
    const { upsertPrice } = await import('../src/index');
    await upsertPrice(database, ws, { accountId: fund.id, onDate: '2025-12-31', priceMicro: 1_100_000_000 });
    expect(await valueOn('2025-12-31')).toMatchObject({ valueMinor: 1_100_000, costMinor: 1_000_000 });
    await money('buy', '2026-02-01', 300_000);
    expect(await valueOn('2026-02-01')).toMatchObject({ valueMinor: 1_400_000, costMinor: 1_300_000 });
  });
});

describe('a fund from its units days, now tracked by money', () => {
  it('still re-books a sell from the units days when an earlier buy changes, and keeps the ledger in step', async () => {
    // Its trades were saved while it was counted in units (no profile yet), then it became a fund tracked by money.
    const old = await createAccount(database, ws, { name: 'Old fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    const units = (kind: 'buy' | 'sell', occurredOn: string, unitsMicro: number, grossMinor: number) =>
      recordTrade(database, ws, { accountId: old.id, kind, occurredOn, unitsMicro, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });
    const first = await units('buy', '2025-01-01', 1_000_000_000, 1_000_000);
    await units('sell', '2025-06-01', 500_000_000, 600_000);
    await saveAssetProfile(database, ws, { accountId: old.id, assetKind: 'fund' });
    expect((await positionsFor(database, ws))[old.id]).toMatchObject({ costMinor: 500_000, realizedMinor: 100_000 });

    const result = await replaceTrade(database, ws, first.tradeId, {
      accountId: old.id, kind: 'buy', occurredOn: '2025-01-01', unitsMicro: 1_000_000_000, grossMinor: 1_200_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id,
    });

    expect(result.recalculatedSells).toEqual([expect.objectContaining({ oldBasisMinor: 500_000, newBasisMinor: 600_000 })]);
    expect((await nativeBalances(database, ws))[old.id]).toBe(600_000);
    expect((await positionsFor(database, ws))[old.id]).toMatchObject({ costMinor: 600_000, realizedMinor: 0 });
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });
});

describe('a fund on the tax report with no money left in it', () => {
  it('is still declared, at no cost, when only a value was typed', async () => {
    await recordValuation(database, ws, { accountId: fund.id, asOf: '2026-12-01', valueMinor: 250_000, basis: 'estimate' });
    const row = (await coretaxInputsFor(database, ws, 2026)).holdings.find((holding) => holding.accountId === fund.id);
    expect(row).toMatchObject({ valueMinor: 250_000, byYear: { '2026': { costMinor: 0 } } });
  });

  it('is still declared when every rupiah put in was taken out and value is left', async () => {
    await money('buy', '2026-03-01', 1_000_000);
    await recordValuation(database, ws, { accountId: fund.id, asOf: '2026-06-01', valueMinor: 1_000_000, basis: 'estimate' });
    await money('sell', '2026-06-02', 1_000_000);
    await recordValuation(database, ws, { accountId: fund.id, asOf: '2026-12-01', valueMinor: 30_000, basis: 'estimate' });
    const row = (await coretaxInputsFor(database, ws, 2026)).holdings.find((holding) => holding.accountId === fund.id);
    expect(row).toMatchObject({ valueMinor: 30_000, byYear: { '2026': { costMinor: 0 } } });
  });
});
