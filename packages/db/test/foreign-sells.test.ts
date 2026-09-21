import { rateFromAmounts } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, checkLedgerIntegrity, createAccount, type Database, deleteTrade, listTrades, nativeBalances, recordTrade, replaceTrade,
  postedTradeMoney, saveAssetProfile, schema, type WorkspaceContext,
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

describe('what a posted trade moved through its cash account, read back for an edit', () => {
  it('is what reached the rupiah account for a sell, and what left it for a buy', async () => {
    const sell = (await listTrades(database, ws)).find((t) => t.kind === 'sell')!;
    expect(await postedTradeMoney(database, ws, sell.id)).toMatchObject({ cashMinor: 14_588_501 });
    const paid = await recordTrade(database, ws, {
      accountId: aapl.id, kind: 'buy', occurredOn: '2026-07-01', unitsMicro: shares(1), grossMinor: 21_000, feeMinor: 100, taxMinor: 0, cashAccountId: bca.id,
      cashMinor: 3_421_003, ratesToBase: { USD: rateFromAmounts(21_100, 'USD', 3_421_003, 'IDR') },
    });
    expect(await postedTradeMoney(database, ws, paid.tradeId)).toMatchObject({ cashMinor: 3_421_003 });
  });

  it('has no charged figure for a trade in one currency, and refuses a trade from another workspace', async () => {
    expect((await postedTradeMoney(database, ws, secondBuy)).cashMinor).toBeUndefined();
    await expect(postedTradeMoney(database, { ...ws, workspaceId: 'elsewhere' }, secondBuy)).rejects.toThrow(/not found/i);
  });
});

describe('a sell whose fees ate the proceeds, into a rupiah account', () => {
  it('records with nothing reaching the account, no amount in rupiah and no worked-out rate — the fees still post', async () => {
    // 1 share sold for $150,00 with a $150,00 fee: the whole sale went on the fee.
    const sold = await recordTrade(database, ws, {
      accountId: aapl.id, kind: 'sell', occurredOn: '2026-07-01', unitsMicro: shares(1), grossMinor: 15_000, feeMinor: 15_000, taxMinor: 0, cashAccountId: bca.id,
      ratesToBase: { USD: 16_300 },
    });
    expect((await nativeBalances(database, ws))[bca.id]).toBe(1_000_000 + 14_588_501);
    const lines = await database.db.select().from(schema.entries).where(eq(schema.entries.transactionId, sold.transactionId!));
    expect(lines.some((l) => l.accountId === bca.id)).toBe(false);
    expect(lines.every((l) => l.currency === 'USD' && l.fxRateToBase === 16_300)).toBe(true);
    expect((await postedTradeMoney(database, ws, sold.tradeId)).cashMinor).toBeUndefined();
    // An earlier buy deleted reworks it on its own day, still with nothing reaching the account.
    await deleteTrade(database, ws, secondBuy);
    expect((await nativeBalances(database, ws))[bca.id]).toBe(1_000_000 + 14_588_501);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('pays the shortfall from the account when the fees and tax passed the proceeds, and reads it back as what left', async () => {
    const sold = await recordTrade(database, ws, {
      accountId: aapl.id, kind: 'sell', occurredOn: '2026-07-01', unitsMicro: shares(1), grossMinor: 15_000, feeMinor: 15_000, taxMinor: 100, cashAccountId: bca.id,
      cashMinor: 16_231, ratesToBase: { USD: rateFromAmounts(100, 'USD', 16_231, 'IDR') },
    });
    expect((await nativeBalances(database, ws))[bca.id]).toBe(1_000_000 + 14_588_501 - 16_231);
    expect((await postedTradeMoney(database, ws, sold.tradeId)).cashMinor).toBe(16_231);
    await deleteTrade(database, ws, secondBuy);
    expect((await nativeBalances(database, ws))[bca.id]).toBe(1_000_000 + 14_588_501 - 16_231);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });
});
