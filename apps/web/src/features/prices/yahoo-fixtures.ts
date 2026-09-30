import { createAccount, createDatabase, createWorkspace, linkHolding, listSecurities, migrate, recordTrade, saveAssetProfile } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';

/** Yahoo's chart for a symbol: one finished close on Tue 29 Sep 2026 (09:00 WIB), in the currency given. */
export const yahooChart = (close: number, currency = 'IDR') => ({
  chart: {
    result: [
      {
        meta: { currency, exchangeTimezoneName: 'Asia/Jakarta', gmtoffset: 25200, currentTradingPeriod: { regular: { start: 1790733600, end: 1790759700 } } },
        timestamp: [1790647200],
        indicators: { quote: [{ close: [close] }] },
      },
    ],
    error: null,
  },
});

/** A workspace holding BBCA at two brokers and TLKM at one, each linked to its security. */
export async function holdings() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const ids: Record<string, string> = {};
  for (const [name, ticker] of [['BBCA · Stockbit', 'BBCA'], ['BBCA · Mandiri', 'BBCA'], ['TLKM', 'TLKM']] as const) {
    const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'stock' });
    await recordTrade(database, ws, { accountId: account.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: 100_000_000, grossMinor: 600_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await linkHolding(database, ws, { accountId: account.id, security: { ticker, name: ticker, market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' } });
    ids[name] = account.id;
  }
  const securities = await listSecurities(database, ws);
  const securityOf = (ticker: string) => securities.find((s) => s.ticker === ticker)!.id;
  return { database, ws, ids, securityOf };
}
