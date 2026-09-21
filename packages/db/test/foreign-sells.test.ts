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

  // I4: `recalculateSells` builds `tradeAccounts` once, off `later[0]`'s own cash account, and reuses it for every
  // later sell whose cash account matches — but a second later sell into a *different* account has to read its
  // own (`withCash`). One sell alone can never tell the two apart: this puts a second later sell, into a second
  // cash account, after the same edit.
  it('reads each later sell’s own cash account, never the earliest later sell’s', async () => {
    // A second cash account in a *third* currency: with a wrong (rupiah) account read back for this sell,
    // `inflowTo` finds no line there at all in its own transaction, and 0 is a value `cashLines` still accepts
    // (defined, not `undefined`) for a cross-currency sell — so the wrong figure would quietly repost, not refuse.
    const dbs = await createAccount(database, ws, { name: 'DBS Vickers SGD', kind: 'asset', subtype: 'bank', currency: 'SGD' });
    const secondSell = await recordTrade(database, ws, {
      accountId: aapl.id, kind: 'sell', occurredOn: '2026-07-01', unitsMicro: shares(3), grossMinor: 67_500, feeMinor: 0, taxMinor: 0, cashAccountId: dbs.id,
      cashMinor: 9_260, ratesToBase: { USD: 16_200, SGD: 11_800 },
    });

    const result = await deleteTrade(database, ws, secondBuy); // moves the basis of both later sells
    expect(result.recalculatedSells).toHaveLength(2);

    // The rupiah sell still reads exactly what reached BCA.
    expect((await sellLines()).map((l) => l.amountMinor)).toEqual([14_588_501]);
    // The Singapore-dollar sell still reads exactly what reached DBS — never 0, and never BCA's rupiah account.
    const resold = (await listTrades(database, ws)).find((t) => t.id === secondSell.tradeId)!;
    const dbsLines = await database.db
      .select()
      .from(schema.entries)
      .where(and(eq(schema.entries.transactionId, resold.transactionId!), eq(schema.entries.accountId, dbs.id)));
    expect(dbsLines.map((l) => l.amountMinor)).toEqual([9_260]);
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
    // m1: `/not found/i` alone also matches `tradeAccountsFor`'s "Asset not found in this workspace", which is
    // what a dropped workspace filter on the trade row (7Aa6) would fall through to — masking the very filter
    // this asserts. The trade's own message is the one this line has to fail without.
    await expect(postedTradeMoney(database, { ...ws, workspaceId: 'elsewhere' }, secondBuy)).rejects.toThrow(/Trade not found/);
  });

  // m2: the `status = 'active'` filter on the trade row (7Aa7) — a retired trade must read the same "not found" a
  // missing one does, not the figure it was last posted at.
  it('refuses a retired trade, never its old figure', async () => {
    const retired = secondBuy;
    await deleteTrade(database, ws, retired);
    await expect(postedTradeMoney(database, ws, retired)).rejects.toThrow(/Trade not found/);
  });

  // m2: the no-transaction guard (7Ab2) — a unit change never posts a line (`tradePostings` returns none for it),
  // so its trade row carries no `transactionId` at all. Without the guard this reads as "0 left the account"
  // rather than "nothing to read"; only `kind: 'unit_change'` can reach this row with `transactionId: null`
  // today, since a buy or a sell both refuse to post at cost 0.
  it('answers no figure for a trade that posted no transaction, rather than reading it as 0', async () => {
    // Named against a rupiah account, so `postedMoneyTx`'s own same-currency shortcut cannot also explain the
    // answer: without the guard this reads `inflowTo` of no lines at all, which is a defined 0, not "unknown".
    const unitChange = await recordTrade(database, ws, { accountId: aapl.id, kind: 'unit_change', occurredOn: '2026-08-01', unitsMicro: shares(1), grossMinor: 0, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id });
    expect(unitChange.transactionId).toBeNull();
    expect(await postedTradeMoney(database, ws, unitChange.tradeId)).toEqual({ ratesToBase: {} });
  });
});
