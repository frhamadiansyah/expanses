import { beforeEach, describe, expect, it } from 'vitest';
import { brokerFeesOf, chargedAtBrokerOn, createAccount, type Database, recordTrade, saveAssetProfile, saveBrokerFees, type WorkspaceContext } from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('a broker’s fees', () => {
  it('start from its name, and are saved on its cash account', async () => {
    const mandiri = await createAccount(database, ws, { name: 'Mandiri Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR' });
    const other = await createAccount(database, ws, { name: 'My broker', kind: 'asset', subtype: 'fund', currency: 'IDR' });
    expect(await brokerFeesOf(database, ws, mandiri.id)).toEqual({ buyPpm: 1_800, sellPpm: 2_800, minDailyMinor: 5_000, saved: false });
    expect(await brokerFeesOf(database, ws, other.id)).toEqual({ buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null, saved: false });
    await saveBrokerFees(database, ws, other.id, { buyPpm: 1_900, sellPpm: 2_900, minDailyMinor: 2_500 });
    expect(await brokerFeesOf(database, ws, other.id)).toEqual({ buyPpm: 1_900, sellPpm: 2_900, minDailyMinor: 2_500, saved: true });
  });

  it('are refused on anything but a broker’s cash account', async () => {
    const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await expect(saveBrokerFees(database, ws, bank.id, { buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null })).rejects.toThrow(/broker/);
  });

  it('count what was charged at the broker that day, for its daily minimum', async () => {
    const broker = await createAccount(database, ws, { name: 'Mandiri Sekuritas', kind: 'asset', subtype: 'fund', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
    const bbca = await createAccount(database, ws, { name: 'BBCA', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: bbca.id, assetKind: 'stock' });
    const buy = { accountId: bbca.id, kind: 'buy' as const, unitsMicro: 100_000_000, grossMinor: 615_000, taxMinor: 0, cashAccountId: broker.id };
    await recordTrade(database, ws, { ...buy, occurredOn: '2026-09-29', feeMinor: 5_000 });
    await recordTrade(database, ws, { ...buy, occurredOn: '2026-09-30', feeMinor: 5_000 });
    await recordTrade(database, ws, { ...buy, occurredOn: '2026-09-30', feeMinor: 1_107 });
    expect(await chargedAtBrokerOn(database, ws, broker.id, '2026-09-30')).toBe(6_107);
    expect(await chargedAtBrokerOn(database, ws, broker.id, '2026-10-01')).toBe(0);
  });
});
