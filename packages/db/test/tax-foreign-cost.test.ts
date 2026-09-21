import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, addHolding, assetsSchema, baseCosts, coretaxInputsFor, createAccount, type Database, listTrades, recordTrade, saveAssetProfile, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let ibkr: AccountRow;
let aaplId: string;
const shares = (n: number) => n * 1_000_000;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  ibkr = await createAccount(database, ws, { name: 'Interactive Brokers', kind: 'asset', subtype: 'fund', currency: 'USD' });
  const first = await addHolding(database, ws, {
    security: { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share', source: 'owner' },
    broker: { accountId: ibkr.id },
    buy: { occurredOn: '2025-03-08', unitsMicro: shares(10), grossMinor: 182_500, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 15_800 } },
  });
  aaplId = first.accountId;
  await recordTrade(database, ws, { accountId: aaplId, kind: 'buy', occurredOn: '2026-01-21', unitsMicro: shares(5), grossMinor: 107_035, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 16_100 } });
  await recordTrade(database, ws, { accountId: aaplId, kind: 'sell', occurredOn: '2026-06-01', unitsMicro: shares(4), grossMinor: 90_000, feeMinor: 0, taxMinor: 0, cashAccountId: ibkr.id, ratesToBase: { USD: 16_300 } });
});

describe('a foreign holding’s cost in the tax report', () => {
  it('is the base amount each buy pinned on its own day, shared out after a sell', async () => {
    const costs = await baseCosts(database, ws, '2026-12-31');
    expect(Object.values(costs.buyBaseMinor).sort((a, b) => a - b)).toEqual([17_232_635, 28_835_000]);
    const inputs = await coretaxInputsFor(database, ws, 2026);
    const aapl = inputs.holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.byYear).toEqual({
      '2025': { unitsMicro: 7_333_333, costMinor: 21_145_666 },
      '2026': { unitsMicro: 3_666_667, costMinor: 12_637_266 },
    });
    expect(aapl.name).toBe('Saham AAPL — Interactive Brokers');
    expect(aapl.purchases).toEqual([
      { occurredOn: '2025-03-08', nativeMinor: 182_500, baseMinor: 28_835_000 },
      { occurredOn: '2026-01-21', nativeMinor: 107_035, baseMinor: 17_232_635 },
    ]);
  });

  it('reads a year before the second buy on its own', async () => {
    const aapl = (await coretaxInputsFor(database, ws, 2025)).holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.byYear).toEqual({ '2025': { unitsMicro: 10_000_000, costMinor: 28_835_000 } });
  });

  it('names only the buys on or before 31 December of the report year', async () => {
    await recordTrade(database, ws, { accountId: aaplId, kind: 'buy', occurredOn: '2027-01-04', unitsMicro: shares(1), grossMinor: 20_000, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 16_400 } });
    const aapl = (await coretaxInputsFor(database, ws, 2026)).holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.purchases!.map((p) => p.occurredOn)).toEqual(['2025-03-08', '2026-01-21']);
    expect(aapl.byYear['2027']).toBeUndefined();
  });

  it('leaves a base-currency holding with no security exactly as it was', async () => {
    const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    const bought = await recordTrade(database, ws, { accountId: gold.id, kind: 'buy', occurredOn: '2026-02-01', unitsMicro: shares(10), grossMinor: 18_600_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    const row = (await coretaxInputsFor(database, ws, 2026)).holdings.find((h) => h.accountId === gold.id)!;
    expect(row).toMatchObject({ name: 'Antam gold bars', byYear: { '2026': { unitsMicro: 10_000_000, costMinor: 18_600_000 } } });
    expect(row.purchases).toBeUndefined();
    // m8: `positions` reads a base-currency buy with `positionAfter`, in its own currency — `buyBaseMinor` is
    // `positionInBase`'s input alone, and nothing keys a base-currency buy into it any more.
    expect(await baseCosts(database, ws)).toMatchObject({ buyBaseMinor: expect.not.objectContaining({ [bought.tradeId]: expect.anything() }) });
  });

  // I1: every buy above has feeMinor and taxMinor at 0, so `nativeMinor: trade.grossMinor` alone would have
  // survived unnoticed — this is the one buy in the suite with both, on a holding of its own so the figures
  // stay simple. Pasal 10 counts a buy's cost as gross plus fee plus tax.
  it('counts a buy’s fee and tax into its native cost, so the note’s rate is never the price alone', async () => {
    const schwab = await createAccount(database, ws, { name: 'Schwab', kind: 'asset', subtype: 'fund', currency: 'USD' });
    const { accountId: msftId } = await addHolding(database, ws, {
      security: { ticker: 'MSFT', name: 'MSFT name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share', source: 'owner' },
      broker: { accountId: schwab.id },
      buy: { occurredOn: '2026-02-02', unitsMicro: shares(1), grossMinor: 100_000, feeMinor: 1_000, taxMinor: 500, cashAccountId: null, ratesToBase: { USD: 15_800 } },
    });
    const trade = (await listTrades(database, ws, { accountId: msftId }))[0]!;
    const costs = await baseCosts(database, ws, '2026-12-31');
    // (1.000,00 + 10,00 fee + 5,00 tax) × 15.800 = 1.015,00 × 15.800
    expect(costs.buyBaseMinor[trade.id]).toBe(16_037_000);
    const msft = (await coretaxInputsFor(database, ws, 2026)).holdings.find((row) => row.accountId === msftId)!;
    expect(msft.purchases).toEqual([{ occurredOn: '2026-02-02', nativeMinor: 101_500, baseMinor: 16_037_000 }]);
    expect(msft.byYear).toEqual({ '2026': { unitsMicro: 1_000_000, costMinor: 16_037_000 } });
  });

  // I2: only AAPL exists above, so `purchases` filtering by holding and `onHolding` keying by holding both pass
  // for the wrong reason — there is nothing else for either to be confused with. A second foreign holding, at a
  // different broker and a different rate, proves each holding reads only its own buys.
  it('keeps two foreign holdings’ purchases and cost apart', async () => {
    const dbs = await createAccount(database, ws, { name: 'DBS Vickers', kind: 'asset', subtype: 'fund', currency: 'USD' });
    const { accountId: vooId } = await addHolding(database, ws, {
      security: { ticker: 'VOO', name: 'VOO name', market: 'NYSE', currency: 'USD', lotSize: null, kind: 'etf', source: 'owner' },
      broker: { accountId: dbs.id },
      buy: { occurredOn: '2026-02-10', unitsMicro: shares(5), grossMinor: 200_000, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 16_000 } },
    });
    const costs = await baseCosts(database, ws, '2026-12-31');
    const inputs = await coretaxInputsFor(database, ws, 2026);

    // AAPL is exactly what it was with VOO absent (the very figures the first test checks) — nothing leaked in.
    const aapl = inputs.holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.purchases).toEqual([
      { occurredOn: '2025-03-08', nativeMinor: 182_500, baseMinor: 28_835_000 },
      { occurredOn: '2026-01-21', nativeMinor: 107_035, baseMinor: 17_232_635 },
    ]);
    expect(aapl.byYear).toEqual({
      '2025': { unitsMicro: 7_333_333, costMinor: 21_145_666 },
      '2026': { unitsMicro: 3_666_667, costMinor: 12_637_266 },
    });

    const voo = inputs.holdings.find((row) => row.accountId === vooId)!;
    expect(voo.purchases).toEqual([{ occurredOn: '2026-02-10', nativeMinor: 200_000, baseMinor: 32_000_000 }]); // 2.000,00 × 16.000
    expect(voo.byYear).toEqual({ '2026': { unitsMicro: 5_000_000, costMinor: 32_000_000 } });
    const vooTrade = (await listTrades(database, ws, { accountId: vooId }))[0]!;
    expect(costs.buyBaseMinor[vooTrade.id]).toBe(32_000_000);
  });

  // I3: `tradePostings` refuses a real buy at cost 0 (`A buy needs an amount greater than zero`), so there is no
  // way through `recordTrade` today to give a foreign buy `transactionId: null` — the very shape base-costs.ts's
  // guard exists for (bonus shares, or anything else that arrives with units and no cost). The row is nulled
  // directly here, standing in for such a buy, to prove the guard the report leans on when one does turn up.
  it('does not throw on a foreign buy that posted no transaction, such as bonus shares', async () => {
    const gift = await recordTrade(database, ws, {
      accountId: aaplId, kind: 'buy', occurredOn: '2026-03-01', unitsMicro: shares(2), grossMinor: 1, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 15_800 },
    });
    await database.db.update(assetsSchema.investmentTrades).set({ transactionId: null }).where(eq(assetsSchema.investmentTrades.id, gift.tradeId));

    const costs = await baseCosts(database, ws, '2026-12-31');
    expect(costs.buyBaseMinor[gift.tradeId]).toBe(0);
    // Units still count: 10 + 5 + 2 bought, 4 sold, 13 left — the gift is not dropped from the position.
    expect(costs.positions[aaplId]!.unitsMicro).toBe(shares(13));

    const inputs = await coretaxInputsFor(database, ws, 2026);
    const aapl = inputs.holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.purchases).toContainEqual({ occurredOn: '2026-03-01', nativeMinor: 1, baseMinor: 0 });
  });
});
