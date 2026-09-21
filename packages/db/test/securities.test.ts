import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, archiveAccount, createAccount, createWorkspace, type Database, getAssetProfile, linkHolding, listHoldingLinks, listPrices,
  listSecurities, listSecurityPrices, type NewSecurity, saveAssetProfile, securitiesSchema, securityOfHolding, upsertPrice, upsertSecurityPrice,
  type WorkspaceContext,
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

  it('keeps the same security at two different brokers apart (I2)', async () => {
    const mandiri = await createAccount(database, ws, { name: 'Mandiri Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR' });
    const a = await holding('A');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: bbca, brokerAccountId: stockbit.id });
    await linkHolding(database, ws, { accountId: b.id, security: bbca, brokerAccountId: mandiri.id });
    expect(await listSecurities(database, ws)).toHaveLength(1);
    expect(new Set((await listHoldingLinks(database, ws)).map((l) => l.brokerAccountId))).toEqual(new Set([stockbit.id, mandiri.id]));
  });

  it('does not clash with itself when the same "Kept at" is saved again (m1, R2)', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca, brokerAccountId: stockbit.id });
    await expect(linkHolding(database, ws, { accountId: a.id, security: bbca, brokerAccountId: stockbit.id })).resolves.toBeUndefined();
    expect(await listHoldingLinks(database, ws)).toEqual([{ accountId: a.id, securityId: (await listSecurities(database, ws))[0]!.id, brokerAccountId: stockbit.id }]);
  });

  it('refuses linking anything but a holding (A22)', async () => {
    await expect(linkHolding(database, ws, { accountId: bank.id, security: bbca })).rejects.toThrow(/Only a holding/);
  });

  it('keeps the same ticker on two markets apart (A24)', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: bbca }); // BBCA on IDX
    await linkHolding(database, ws, { accountId: b.id, security: { ...bbca, market: 'OTC' } }); // same ticker, another market
    expect(await listSecurities(database, ws)).toHaveLength(2);
  });

  it('validates a new security before recording it (m7, A17–A20)', async () => {
    const a = await holding('A');
    await expect(linkHolding(database, ws, { accountId: a.id, security: { ...bbca, name: '  ' } })).rejects.toThrow(/name/);
    await expect(linkHolding(database, ws, { accountId: a.id, security: { ...bbca, currency: 'XYZ' } })).rejects.toThrow(/currency/);
    await expect(linkHolding(database, ws, { accountId: a.id, security: { ...bbca, lotSize: 0 } })).rejects.toThrow(/whole number/);
    await expect(linkHolding(database, ws, { accountId: a.id, security: { ...bbca, lotSize: 1.5 } })).rejects.toThrow(/whole number/);
    await expect(linkHolding(database, ws, { accountId: a.id, security: { ...bbca, ticker: '@@' } })).rejects.toThrow(/ticker/);
    expect(await listSecurities(database, ws)).toEqual([]);
  });

  it('refuses a security price on an invalid date (m9, P9)', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    await expect(upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '31-12-2026', priceMicro: 1 })).rejects.toThrow();
    await expect(upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: 'not-a-date', priceMicro: 1 })).rejects.toThrow();
  });

  it('never leaks a link, a price or a clash across workspaces (m6, P6, P10, R5)', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca, brokerAccountId: stockbit.id });
    const [security] = await listSecurities(database, ws);
    await upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: 9_775_000_000 });

    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    // P6: securityOfHolding must not read another workspace's link for the same accountId. accountId is a real
    // primary key, so calling it through listPrices/upsertPrice would mask the bug (listSecurityPrices' own
    // workspace filter would still return [] downstream) — call it directly to pin the guard itself.
    expect(await securityOfHolding(database.db, other, a.id)).toBeNull();
    expect(await listPrices(database, other, a.id)).toEqual([]);
    // P10: listSecurityPrices must not read another workspace's prices for a security id it does not itself hold.
    expect(await listSecurityPrices(database, other, security!.id)).toEqual([]);

    // R5: the clash rule must ignore a holding_links row that only "matches" because it was planted in another
    // workspace — a shape that cannot arise through the app itself (ids are workspace-scoped UUIDs), so it is
    // planted directly to pin the query's own workspace filter, not to model a real user's data.
    const ghost = await createAccount(database, other, { name: 'Ghost', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await database.db.insert(securitiesSchema.holdingLinks).values({
      accountId: ghost.id, workspaceId: other.workspaceId, securityId: security!.id, brokerAccountId: stockbit.id, createdAt: new Date().toISOString(),
    });
    const b = await holding('B'); // a fresh holding in `ws`, never linked to (security, stockbit) there
    await expect(linkHolding(database, ws, { accountId: b.id, security: { id: security!.id }, brokerAccountId: stockbit.id })).rejects.toThrow(/already/);
    // The clash above is the real one (A already holds it in ws): prove the ghost row alone is not enough by
    // removing A's own link and trying again — now nothing in `ws` holds (security, stockbit), so it must succeed.
    await linkHolding(database, ws, { accountId: a.id, security: null });
    await expect(linkHolding(database, ws, { accountId: b.id, security: { id: security!.id }, brokerAccountId: stockbit.id })).resolves.toBeUndefined();
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
    // Ruling m12: once moved, the holding's own rows are removed — no stale series is left to come back.
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${b.id}`)).toEqual([[0]]);
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${a.id}`)).toEqual([[0]]);
  });

  it('gives an unlinked holding the security’s latest price as its own, never its old series (m12)', async () => {
    const a = await holding('A');
    await upsertPrice(database, ws, { accountId: a.id, onDate: '2026-01-05', priceMicro: 8_750_000_000 });
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    await upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: 9_775_000_000 });
    await upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-06-01', priceMicro: 9_100_000_000 });
    await linkHolding(database, ws, { accountId: a.id, security: null });
    expect(await listPrices(database, ws, a.id)).toEqual([{ onDate: '2026-09-19', priceMicro: 9_775_000_000 }]);
    // The security keeps its whole series for every other holding of it.
    expect(await listSecurityPrices(database, ws, security!.id)).toHaveLength(3);
  });

  it('unlinks a security with no price to nothing, and a broker change alone moves no price (m12)', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    await linkHolding(database, ws, { accountId: a.id, brokerAccountId: stockbit.id });
    await linkHolding(database, ws, { accountId: a.id, brokerAccountId: null });
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${a.id}`)).toEqual([[0]]);
    await linkHolding(database, ws, { accountId: a.id, security: null });
    expect(await listPrices(database, ws, a.id)).toEqual([]);
  });

  it('re-points a holding to another security with no stale own price to bring back (m12)', async () => {
    const a = await holding('A');
    await upsertPrice(database, ws, { accountId: a.id, onDate: '2026-01-05', priceMicro: 8_750_000_000 });
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    await linkHolding(database, ws, { accountId: a.id, security: { ...bbca, ticker: 'BBRI', name: 'BBRI name' } });
    const bbri = (await listSecurities(database, ws)).find((s) => s.ticker === 'BBRI')!;
    // Priced by BBRI alone: BBCA's series stays BBCA's, and the holding's old row was removed on the first link.
    expect(await listSecurityPrices(database, ws, bbri.id)).toEqual([]);
    expect(await listPrices(database, ws, a.id)).toEqual([]);
  });

  it('refuses a broker the owner closed (m10)', async () => {
    const a = await holding('A');
    await archiveAccount(database, ws, stockbit.id);
    await expect(linkHolding(database, ws, { accountId: a.id, brokerAccountId: stockbit.id })).rejects.toThrow(/not found/);
  });

  it('refuses a negative security price', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    await expect(upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: -1 })).rejects.toThrow();
  });
});
