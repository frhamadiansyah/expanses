import { describe, expect, it } from 'vitest';
import {
  createAccount,
  declareReinvestment,
  incomeInputsFor,
  recordTrade,
  saveAssetProfile,
  setAssetReporting,
  replaceTrade,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = 2026;
const g = (units: number) => units * 1_000_000;

async function holdings() {
  const { database, ws } = await setupDb();
  const bbri = await createAccount(database, ws, { name: 'BBRI shares', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  const ori = await createAccount(database, ws, { name: 'ORI023', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  const vti = await createAccount(database, ws, { name: 'VTI', kind: 'asset', subtype: 'investment', currency: 'USD' });
  await saveAssetProfile(database, ws, { accountId: bbri.id, assetKind: 'stock' });
  await saveAssetProfile(database, ws, { accountId: ori.id, assetKind: 'bond' });
  await saveAssetProfile(database, ws, { accountId: vti.id, assetKind: 'stock' });
  return { database, ws, bbri, ori, vti };
}

const pay = (
  database: Database,
  ws: WorkspaceContext,
  accountId: string,
  occurredOn: string,
  grossMinor: number,
  taxMinor: number,
  ratesToBase?: Record<string, number>,
) => recordTrade(database, ws, { accountId, kind: 'income', occurredOn, unitsMicro: 0, grossMinor, feeMinor: 0, taxMinor, cashAccountId: null, ratesToBase });

describe('what the year paid', () => {
  it('adds up dividends and coupons from what was recorded', async () => {
    const { database, ws, bbri, ori } = await holdings();
    await pay(database, ws, bbri.id, '2026-04-10', 1_000_000, 100_000);
    await pay(database, ws, ori.id, '2026-05-15', 600_000, 60_000);
    await pay(database, ws, ori.id, '2026-11-15', 600_000, 60_000);

    const rows = await incomeInputsFor(database, ws, YEAR);

    expect(rows.find((row) => row.name === 'BBRI shares')).toMatchObject({ kind: 'dividend', grossMinor: 1_000_000, taxMinor: 100_000 });
    expect(rows.find((row) => row.name === 'ORI023')).toMatchObject({ kind: 'coupon', grossMinor: 1_200_000, taxMinor: 120_000 });
  });

  it('marks a holding abroad, which is not taxed as final here', async () => {
    const { database, ws, vti } = await holdings();
    await pay(database, ws, vti.id, '2026-06-01', 1_400_000, 210_000, { USD: 16_000 });

    expect((await incomeInputsFor(database, ws, YEAR)).find((row) => row.name === 'VTI')).toMatchObject({ foreign: true });
  });

  it('counts a sale once, not the version it replaced', async () => {
    const { database, ws, bbri } = await holdings();
    await recordTrade(database, ws, {
      accountId: bbri.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: g(100), grossMinor: 10_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: null,
    });
    const sale = await recordTrade(database, ws, {
      accountId: bbri.id, kind: 'sell', occurredOn: '2026-08-05', unitsMicro: g(50), grossMinor: 6_000_000, feeMinor: 0, taxMinor: 6_000, cashAccountId: null,
    });
    // Editing a trade retires the old row and writes a fresh one; only the fresh one is income.
    await replaceTrade(database, ws, sale.tradeId, {
      accountId: bbri.id, kind: 'sell', occurredOn: '2026-08-05', unitsMicro: g(50), grossMinor: 7_000_000, feeMinor: 0, taxMinor: 7_000, cashAccountId: null,
    });

    const sales = (await incomeInputsFor(database, ws, YEAR)).filter((row) => row.kind === 'sale');
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ grossMinor: 7_000_000, taxMinor: 7_000 });
  });

  it('leaves out a year that is not the one asked for', async () => {
    const { database, ws, ori } = await holdings();
    await pay(database, ws, ori.id, '2025-05-15', 600_000, 60_000);

    expect(await incomeInputsFor(database, ws, YEAR)).toEqual([]);
  });
});

describe('how the report is told what is taxed', () => {
  it('shows the treatment the owner set on the holding', async () => {
    const { database, ws, ori } = await holdings();
    await pay(database, ws, ori.id, '2026-05-15', 600_000, 60_000);

    await setAssetReporting(database, ws, ori.id, { taxTreatment: 'final' });

    expect((await incomeInputsFor(database, ws, YEAR))[0]).toMatchObject({ name: 'ORI023', treatment: 'final' });
  });

  it('leaves a holding nobody has set as unset', async () => {
    const { database, ws, ori } = await holdings();
    await pay(database, ws, ori.id, '2026-05-15', 600_000, 60_000);

    expect((await incomeInputsFor(database, ws, YEAR))[0]!.treatment).toBeNull();
  });
});

describe('declaring a dividend reinvested', () => {
  it('moves it outside the objects of tax, and says where it went', async () => {
    const { database, ws, bbri, ori } = await holdings();
    const dividend = await pay(database, ws, bbri.id, '2026-03-12', 600_000, 0);

    await declareReinvestment(database, ws, dividend.tradeId, { amountMinor: 600_000, intoAccountId: ori.id });

    const rows = await incomeInputsFor(database, ws, YEAR);
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'BBRI shares',
        treatment: 'not_object',
        grossMinor: 600_000,
        reinvestedInto: [{ accountId: ori.id, name: 'ORI023', amountMinor: 600_000 }],
      }),
    ]);
  });

  it('splits a payment reinvested in part', async () => {
    const { database, ws, bbri, ori } = await holdings();
    await setAssetReporting(database, ws, bbri.id, { taxTreatment: 'final' });
    const dividend = await pay(database, ws, bbri.id, '2026-03-12', 600_000, 20_000);

    await declareReinvestment(database, ws, dividend.tradeId, { amountMinor: 400_000, intoAccountId: ori.id });

    const rows = await incomeInputsFor(database, ws, YEAR);
    expect(rows.find((row) => row.treatment === 'not_object')).toMatchObject({ grossMinor: 400_000, taxMinor: 0 });
    expect(rows.find((row) => row.treatment === 'final')).toMatchObject({ grossMinor: 200_000, taxMinor: 20_000 });
  });

  it('is cleared by declaring nothing', async () => {
    const { database, ws, bbri, ori } = await holdings();
    const dividend = await pay(database, ws, bbri.id, '2026-03-12', 600_000, 0);
    await declareReinvestment(database, ws, dividend.tradeId, { amountMinor: 600_000, intoAccountId: ori.id });

    await declareReinvestment(database, ws, dividend.tradeId, { amountMinor: 0, intoAccountId: null });

    expect((await incomeInputsFor(database, ws, YEAR))[0]!.treatment).toBeNull();
  });

  it('refuses more than the payment was worth', async () => {
    const { database, ws, bbri, ori } = await holdings();
    const dividend = await pay(database, ws, bbri.id, '2026-03-12', 600_000, 0);

    await expect(declareReinvestment(database, ws, dividend.tradeId, { amountMinor: 900_000, intoAccountId: ori.id })).rejects.toThrow();
  });

  it('refuses to call proceeds from a sale a reinvested dividend', async () => {
    const { database, ws, bbri, ori } = await holdings();
    await recordTrade(database, ws, {
      accountId: bbri.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: 100_000_000, grossMinor: 10_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: null,
    });
    const sale = await recordTrade(database, ws, {
      accountId: bbri.id, kind: 'sell', occurredOn: '2026-08-05', unitsMicro: 50_000_000, grossMinor: 6_000_000, feeMinor: 0, taxMinor: 6_000, cashAccountId: null,
    });

    await expect(declareReinvestment(database, ws, sale.tradeId, { amountMinor: 6_000_000, intoAccountId: ori.id })).rejects.toThrow();
  });
});
