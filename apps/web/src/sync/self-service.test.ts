import { expenseLines } from '@expanses/core';
import { createAccount, createDatabase, createWorkspace, type Database, listAccounts, MemoryKeyStore, MemoryTransport, migrate, postTransaction, requestSignerOf, SeatElsewhereError } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydratePrefs, mirrorPref, setPrefDatabase } from '../lib/synced-prefs';
import { keepPlan, LINK_FAILED_KEY, LINK_PLAN_KEY, SelfService, thisDeviceInfo } from './self-service';
import { SyncService } from './sync-service';

vi.setConfig({ testTimeout: 120_000 });

/*
 * Link my devices in the app (Drop 3): the open finishing a link under way, the seat rule keeping household sharing
 * off a linked device that is not the seat, and the choices kept in localStorage reaching the other devices.
 * Two devices in memory, invented data (a made-up bank and shop).
 */

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setPrefDatabase(null);
});

async function device(relay: MemoryTransport, info = thisDeviceInfo('Mozilla/5.0 (iPhone)')) {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const keyStore = new MemoryKeyStore();
  const self = new SelfService({ database, keyStore, info, transportFor: (keys) => relay.as(requestSignerOf(keys)) });
  return { database, ws, keyStore, self };
}

/** The whole link as the two sheets drive it, ending with the new device's data replaced and its next open done. */
async function link(relay: MemoryTransport, phone: Awaited<ReturnType<typeof device>>, mac: Awaited<ReturnType<typeof device>>): Promise<SelfService> {
  const { sessionId, code } = await phone.self.startLinking();
  await mac.self.joinWithCode(code);
  await phone.self.checkLinking(sessionId);
  await mac.self.checkJoining(sessionId);
  await phone.self.checkLinking(sessionId);
  await phone.self.allowLinking(sessionId);
  expect(await mac.self.checkJoining(sessionId)).toEqual({ stage: 'allowed' });
  const { plan, bytes } = await mac.self.fetchCopy(sessionId);
  keepPlan(plan);
  await mac.database.importBytes(bytes);
  // The reload: a fresh service on the replaced database, the same keys.
  const reopened = new SelfService({ database: mac.database, keyStore: mac.keyStore, info: mac.self.info, transportFor: (keys) => relay.as(requestSignerOf(keys)) });
  await reopened.prepare();
  return reopened;
}

describe('the open after a link', () => {
  it('makes the copy this device’s own, forgets the plan, and the two devices then sync', async () => {
    const relay = new MemoryTransport();
    const phone = await device(relay);
    const bank = (await createAccount(phone.database, phone.ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
    const mac = await device(relay, thisDeviceInfo('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)'));
    storage.setItem('expanses.dev-sample-loaded', '1');
    const self = await link(relay, phone, mac);
    expect(self.joinOutcome).toBe('linked');
    expect(storage.getItem(LINK_PLAN_KEY)).toBeNull();
    expect(storage.getItem('expanses.dev-sample-loaded')).toBeNull();
    expect(await mac.database.db.values(sql`SELECT name FROM accounts WHERE id = ${bank}`)).toEqual([['Test Bank']]);
    await self.refresh();
    expect(self.status().devices.map((d) => [d.name, d.thisDevice])).toEqual([
      ['iPhone', false],
      ['Mac', true],
    ]);
  });

  it('with the old data still here (the replace never happened), drops the plan and changes nothing', async () => {
    const relay = new MemoryTransport();
    const phone = await device(relay);
    const mac = await device(relay);
    const { sessionId, code } = await phone.self.startLinking();
    await mac.self.joinWithCode(code);
    await phone.self.checkLinking(sessionId);
    await mac.self.checkJoining(sessionId);
    await phone.self.checkLinking(sessionId);
    await phone.self.allowLinking(sessionId);
    const { plan } = await mac.self.fetchCopy(sessionId);
    keepPlan(plan);
    const before = await mac.database.exportBytes();
    const reopened = new SelfService({ database: mac.database, keyStore: mac.keyStore, info: mac.self.info, transportFor: (keys) => relay.as(requestSignerOf(keys)) });
    await reopened.prepare();
    expect(reopened.joinOutcome).toBe('failed');
    expect(storage.getItem(LINK_PLAN_KEY)).toBeNull();
    expect(storage.getItem(LINK_FAILED_KEY)).toBe('1');
    expect(Buffer.from(await mac.database.exportBytes()).equals(Buffer.from(before))).toBe(true);
  });
});

describe('the seat', () => {
  it('household sharing does not run on a linked device that is not the seat, and its shared workspace is view-only', async () => {
    const relay = new MemoryTransport();
    const phone = await device(relay);
    const groceries = (await listAccounts(phone.database, phone.ws)).find((a) => a.name === 'Groceries')!.id;
    const bank = (await createAccount(phone.database, phone.ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
    const bookId = (await phone.database.db.values<[string]>(sql`SELECT id FROM books LIMIT 1`))[0]![0];
    await phone.database.db.run(sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${bookId}, 'test-relay', 1, 'test-member', 'active', '2026-11-01T00:00:00Z')`);
    const mac = await device(relay);
    await link(relay, phone, mac);
    const sync = new SyncService({ database: mac.database, keyStore: mac.keyStore, transportFor: (keys) => relay.as(requestSignerOf(keys)), shareRecords: null });
    await sync.prepare();
    expect(sync.elsewhere).toBe(true);
    // The copied bookkeeping is left exactly as the seat wrote it: never turned to "needs a new invite" here.
    expect(await mac.database.db.values(sql`SELECT state FROM shared_books`)).toEqual([['active']]);
    await expect(
      // The Mac's data is now the iPhone's: its workspace too.
      postTransaction(mac.database, phone.ws, { occurredOn: '2026-11-20', description: 'Test shop', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 9_000, currency: 'IDR' }) }),
    ).rejects.toBeInstanceOf(SeatElsewhereError);
  });
});

describe('the choices kept on the device', () => {
  async function bare(): Promise<Database> {
    const database = createDatabase(createNodeExecutor());
    await migrate(database);
    return database;
  }

  it('a choice written here goes into settings for the other devices; one from another device wins at the next read', async () => {
    const database = await bare();
    setPrefDatabase(database);
    storage.setItem('health.ratio-settings', '{"months":6}');
    mirrorPref('health.ratio-settings', '{"months":6}');
    mirrorPref('wallet.view', 'grid'); // a view choice stays on the device
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await database.db.values(sql`SELECT key, value FROM settings WHERE key LIKE 'pref.%'`)).toEqual([['pref.health.ratio-settings', '{"months":6}']]);
    await database.db.run(sql`UPDATE settings SET value = '{"months":3}' WHERE key = 'pref.health.ratio-settings'`);
    await hydratePrefs(database, storage);
    expect(storage.getItem('health.ratio-settings')).toBe('{"months":3}');
  });

  it('a choice made before this build, kept only on the device, goes into settings once', async () => {
    const database = await bare();
    storage.setItem('expanses.currency.favorites', '["IDR","SGD"]');
    await hydratePrefs(database, storage);
    expect(await database.db.values(sql`SELECT value FROM settings WHERE key = 'pref.expanses.currency.favorites'`)).toEqual([['["IDR","SGD"]']]);
  });
});

describe('what this device is called', () => {
  it('by its kind', () => {
    expect(thisDeviceInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toMatchObject({ name: 'iPhone', kind: 'phone' });
    expect(thisDeviceInfo('Mozilla/5.0 (iPad; CPU OS 18_0)')).toMatchObject({ name: 'iPad', kind: 'tablet' });
    expect(thisDeviceInfo('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', 0)).toMatchObject({ name: 'Mac', kind: 'mac' });
    expect(thisDeviceInfo('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', 5)).toMatchObject({ name: 'iPad', kind: 'tablet' });
  });
});
