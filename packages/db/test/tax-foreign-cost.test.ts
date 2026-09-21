import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, addHolding, baseCosts, coretaxInputsFor, createAccount, type Database, recordTrade, saveAssetProfile, type WorkspaceContext,
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
    await recordTrade(database, ws, { accountId: gold.id, kind: 'buy', occurredOn: '2026-02-01', unitsMicro: shares(10), grossMinor: 18_600_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    const row = (await coretaxInputsFor(database, ws, 2026)).holdings.find((h) => h.accountId === gold.id)!;
    expect(row).toMatchObject({ name: 'Antam gold bars', byYear: { '2026': { unitsMicro: 10_000_000, costMinor: 18_600_000 } } });
    expect(row.purchases).toBeUndefined();
  });
});
