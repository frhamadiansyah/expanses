import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, createAccount, createWorkspace, type Database, getAssetProfile, linkHolding, listHoldingLinks, listSecurities,
  listSecurityPrices, type NewSecurity, saveAssetProfile, upsertPrice, upsertSecurityPrice, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let stockbit: AccountRow;
let card: AccountRow;
let bank: AccountRow;
const bbca: NewSecurity = { ticker: 'bbca ', name: 'BBCA name', market: 'idx', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' };
const aapl: NewSecurity = { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: 1, kind: 'share', source: 'owner' };

async function holding(name: string, currency = 'IDR') {
  const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'stock' });
  return account;
}

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  stockbit = await createAccount(database, ws, { name: 'Stockbit', kind: 'asset', subtype: 'fund', currency: 'IDR' });
  card = await createAccount(database, ws, { name: 'BCA Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
});

describe('securities', () => {
  it('is one row per market and ticker, however it is typed', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    await linkHolding(database, ws, { accountId: b.id, security: { ...bbca, ticker: 'BBCA', market: 'IDX', source: 'owner' } });
    const rows = await listSecurities(database, ws);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: 'BBCA', market: 'IDX', lotSize: 100, source: 'catalogue' });
    const links = await listHoldingLinks(database, ws);
    expect(new Set(links.map((l) => l.securityId))).toEqual(new Set([rows[0]!.id]));
  });

  it('keeps two things with no ticker apart, and reads a lot of one as no lots', async () => {
    const a = await holding('A', 'USD');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: aapl });
    await linkHolding(database, ws, { accountId: b.id, security: { ticker: null, name: 'Private fund', market: '', currency: 'IDR', lotSize: null, kind: 'other', source: 'owner' } });
    const rows = await listSecurities(database, ws);
    expect(rows.find((r) => r.ticker === 'AAPL')!.lotSize).toBeNull();
    expect(rows).toHaveLength(2);
  });
});

describe('linkHolding', () => {
  it('refuses a security in another currency than the holding', async () => {
    const idr = await holding('IDR holding');
    await expect(linkHolding(database, ws, { accountId: idr.id, security: aapl })).rejects.toThrow(/USD/);
    expect(await listHoldingLinks(database, ws)).toEqual([]);
  });

  it('takes a broker only as its fund account: never a card, a bank or a pocket, and never from another workspace', async () => {
    const a = await holding('A');
    await expect(linkHolding(database, ws, { accountId: a.id, brokerAccountId: card.id })).rejects.toThrow(/fund account/);
    await expect(linkHolding(database, ws, { accountId: a.id, brokerAccountId: bank.id })).rejects.toThrow(/fund account/);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(linkHolding(database, other, { accountId: a.id, brokerAccountId: stockbit.id })).rejects.toThrow(/not found/);
    expect(await listHoldingLinks(database, ws)).toEqual([]);
  });

  it('takes a fund account that holds pockets as the broker, and refuses one of its pockets', async () => {
    const ibkr = await createAccount(database, ws, { name: 'Interactive Brokers', kind: 'asset', subtype: 'fund', currency: 'USD' });
    const usd = await createAccount(database, ws, { name: 'Interactive Brokers · USD', kind: 'asset', subtype: 'fund', currency: 'USD', parentId: ibkr.id });
    const a = await holding('A', 'USD');
    await expect(linkHolding(database, ws, { accountId: a.id, brokerAccountId: usd.id })).rejects.toThrow(/Interactive Brokers/);
    await linkHolding(database, ws, { accountId: a.id, brokerAccountId: ibkr.id });
    expect(await listHoldingLinks(database, ws)).toEqual([{ accountId: a.id, securityId: null, brokerAccountId: ibkr.id }]);
  });

  it('refuses a second holding for the same security at the same broker', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: bbca, brokerAccountId: stockbit.id });
    await expect(linkHolding(database, ws, { accountId: b.id, security: bbca, brokerAccountId: stockbit.id })).rejects.toThrow(/already/);
  });

  it('carries the holding’s own prices to the security without overwriting one it has, and sets its lot size', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await upsertPrice(database, ws, { accountId: a.id, onDate: '2026-09-12', priceMicro: 9_550_000_000 });
    await upsertPrice(database, ws, { accountId: b.id, onDate: '2026-09-12', priceMicro: 9_600_000_000 });
    await upsertPrice(database, ws, { accountId: b.id, onDate: '2026-09-05', priceMicro: 9_400_000_000 });
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    await linkHolding(database, ws, { accountId: b.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    expect(await listSecurityPrices(database, ws, security!.id)).toEqual([
      { onDate: '2026-09-12', priceMicro: 9_550_000_000 }, // A's stood; B's 9.600 on the same day did not replace it
      { onDate: '2026-09-05', priceMicro: 9_400_000_000 },
    ]);
    expect((await getAssetProfile(database, ws, b.id))!.lotSize).toBe(100);
    // The holding's own rows are left where they were.
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${b.id}`)).toEqual([[2]]);
  });

  it('refuses a negative security price', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    await expect(upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: -1 })).rejects.toThrow();
  });
});
