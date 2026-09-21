import { rateFromAmounts } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, checkLedgerIntegrity, createAccount, type Database, deleteTrade, listTrades, nativeBalances, recordTrade, replaceTrade,
  saveAssetProfile, schema, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const shares = (n: number) => n * 1_000_000;
let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let aapl: AccountRow;
let secondBuy: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2025-01-01' });
  aapl = await createAccount(database, ws, { name: 'AAPL', kind: 'asset', subtype: 'investment', currency: 'USD' });
  await saveAssetProfile(database, ws, { accountId: aapl.id, assetKind: 'stock' });
  await recordTrade(database, ws, { accountId: aapl.id, kind: 'buy', occurredOn: '2025-03-08', unitsMicro: shares(10), grossMinor: 182_500, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 15_800 } });
  secondBuy = (await recordTrade(database, ws, { accountId: aapl.id, kind: 'buy', occurredOn: '2026-01-21', unitsMicro: shares(5), grossMinor: 107_035, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 16_100 } })).tradeId;
  // Sold 4 into a rupiah account: $895,00 net, Rp 14.588.501 arrived (non-round, so a re-derived rate would show).
  await recordTrade(database, ws, {
    accountId: aapl.id, kind: 'sell', occurredOn: '2026-06-01', unitsMicro: shares(4), grossMinor: 90_000, feeMinor: 500, taxMinor: 0, cashAccountId: bca.id,
    cashMinor: 14_588_501, ratesToBase: { USD: rateFromAmounts(89_500, 'USD', 14_588_501, 'IDR') },
  });
});

const sellLines = async () => {
  const sell = (await listTrades(database, ws)).find((t) => t.kind === 'sell')!;
  return database.db.select().from(schema.entries).where(and(eq(schema.entries.transactionId, sell.transactionId!), eq(schema.entries.accountId, bca.id)));
};

describe('a later sell reworked by an edit', () => {
  it('keeps what reached the rupiah account, and its own day’s rate, when an earlier buy is deleted', async () => {
    const result = await deleteTrade(database, ws, secondBuy);
    expect(result.recalculatedSells).toHaveLength(1); // the basis moved: 4 of 10 at $182,50 now, not 4 of 15
    expect((await sellLines()).map((l) => [l.amountMinor, l.currency, l.amountBaseMinor])).toEqual([[14_588_501, 'IDR', 14_588_501]]);
    expect((await nativeBalances(database, ws))[bca.id]).toBe(1_000_000 + 14_588_501);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('does the same when an earlier buy is edited on another day at another rate', async () => {
    const first = (await listTrades(database, ws)).find((t) => t.occurredOn === '2025-03-08')!;
    await replaceTrade(database, ws, first.id, { accountId: aapl.id, kind: 'buy', occurredOn: '2025-03-08', unitsMicro: shares(10), grossMinor: 180_000, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 15_800 } });
    const sell = (await listTrades(database, ws)).find((t) => t.kind === 'sell')!;
    const usdLines = await database.db.select().from(schema.entries).where(and(eq(schema.entries.transactionId, sell.transactionId!), eq(schema.entries.currency, 'USD')));
    // Every USD line of the reposted sell is at the sell's own rate, never the edited buy's 15.800.
    expect(new Set(usdLines.map((l) => l.fxRateToBase))).toEqual(new Set([rateFromAmounts(89_500, 'USD', 14_588_501, 'IDR')]));
    expect((await sellLines()).map((l) => l.amountMinor)).toEqual([14_588_501]);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });
});
