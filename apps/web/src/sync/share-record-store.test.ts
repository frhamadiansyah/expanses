import { IDBFactory } from 'fake-indexeddb';
import { KeychainAccess, StorageErrorType } from '@aparajita/capacitor-secure-storage';
import { deviceKeysOf, generateKeyPairs, type ShareRecord } from '@expanses/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/pwa', () => ({ isNative: () => native.value }));

import { KEYS_DB, KEYS_DB_VERSION, WebKeyStore, type SecureStore } from './key-store';
import { createShareRecordStore, NativeShareRecordStore, WebShareRecordStore } from './share-record-store';

/*
 * Sharing resilience §6.1 (D-B1): the share records live beside the device keys, outside the database. The web store is
 * a second object store `shares` in IndexedDB `cicis-keys` (version 1 → 2, the device keys kept); the native store is
 * one keychain item `cicis-keys.shares`, this device only, never in iCloud (the plugin is faked here — no simulator).
 */

const record = (bookId: string, over: Partial<ShareRecord> = {}): ShareRecord => ({
  v: 1, bookId, relayBookId: `relay-${bookId}`, memberId: 'member-a', deviceId: 'device-a', role: 'owner',
  bookName: 'Home', bookKind: 'family', workspaceId: 'ws-1', baseCurrency: 'IDR',
  epochKeys: [{ epoch: 1, sealed: '{"x":1}' }], appliedSeq: 0, updatedAt: '2026-11-11T00:00:00.000Z', ...over,
});

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('WebShareRecordStore', () => {
  it('WebShareRecordStore keeps records in cicis-keys/shares beside the device keys', async () => {
    const idb = new IDBFactory();
    const keys = new WebKeyStore(idb);
    const device = await keys.getOrCreateDevice();
    const store = new WebShareRecordStore(idb);
    await store.put(record('b1', { deviceId: device.deviceId }));
    expect((await new WebShareRecordStore(idb).list()).map((r) => r.bookId)).toEqual(['b1']);
    expect((await new WebKeyStore(idb).getOrCreateDevice()).deviceId).toBe(device.deviceId); // the version bump keeps the keys
    expect((await idb.databases()).map((d) => [d.name, d.version])).toEqual([[KEYS_DB, KEYS_DB_VERSION]]);
  });

  it('an older build’s version-1 database keeps its device keys through the upgrade', async () => {
    const idb = new IDBFactory();
    // What builds before this one wrote: version 1, the one store `device`, the pairs under `current`.
    const pairs = await generateKeyPairs(false);
    const open = idb.open(KEYS_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('device');
    const v1 = await request(open);
    await request(v1.transaction('device', 'readwrite').objectStore('device').put(pairs, 'current'));
    v1.close();
    const before = await deviceKeysOf(pairs.sign, pairs.agree);

    expect(KEYS_DB_VERSION).toBe(2);
    const store = new WebShareRecordStore(idb);
    expect(await store.list()).toEqual([]);
    await store.put(record('b1'));
    const keys = new WebKeyStore(idb);
    expect(await keys.hasDevice()).toBe(true);
    expect((await keys.getOrCreateDevice()).deviceId).toBe(before.deviceId);
  });

  it('either store may open the database first', async () => {
    const idb = new IDBFactory();
    await new WebShareRecordStore(idb).put(record('b1'));
    const device = await new WebKeyStore(idb).getOrCreateDevice();
    expect((await new WebKeyStore(idb).getOrCreateDevice()).deviceId).toBe(device.deviceId);
    expect((await new WebShareRecordStore(idb).get('b1'))?.relayBookId).toBe('relay-b1');
  });

  it('replaces by book id, gets and removes', async () => {
    const idb = new IDBFactory();
    const store = new WebShareRecordStore(idb);
    await store.put(record('b1'));
    await store.put(record('b2'));
    await store.put(record('b1', { appliedSeq: 9 }));
    expect((await store.list()).map((r) => [r.bookId, r.appliedSeq]).sort()).toEqual([['b1', 9], ['b2', 0]]);
    expect(await store.get('b1')).toEqual(record('b1', { appliedSeq: 9 }));
    await store.remove('b1');
    await store.remove('nope');
    expect(await store.get('b1')).toBeNull();
    expect((await store.list()).map((r) => r.bookId)).toEqual(['b2']);
  });

  it('two writes at once both land', async () => {
    const idb = new IDBFactory();
    await Promise.all([new WebShareRecordStore(idb).put(record('b1')), new WebShareRecordStore(idb).put(record('b2'))]);
    expect((await new WebShareRecordStore(idb).list()).map((r) => r.bookId).sort()).toEqual(['b1', 'b2']);
  });

  it('a stored record that is not a readable v1 record is left out, with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const idb = new IDBFactory();
    const store = new WebShareRecordStore(idb);
    await store.put(record('b1'));
    const open = idb.open(KEYS_DB, KEYS_DB_VERSION);
    const db = await request(open);
    const tx = db.transaction('shares', 'readwrite');
    await request(tx.objectStore('shares').put({ ...record('b2'), v: 2 }));
    await request(tx.objectStore('shares').put({ bookId: 'b3', junk: true }));
    db.close();
    expect((await store.list()).map((r) => r.bookId)).toEqual(['b1']);
    expect(await store.get('b2')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/** The secure-storage plugin, faked: items by key (the prefix kept apart), and every write as it was asked for. */
function fakeSecureStore(initial: Record<string, unknown> = {}, delayMs = 0) {
  const items = new Map<string, unknown>(Object.entries(initial));
  const calls: { key: string; data: string; sync?: boolean; access?: KeychainAccess }[] = [];
  const settings: { prefix?: string; sync?: boolean; access?: KeychainAccess } = {};
  const pause = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  let failReads = false;
  const storage: SecureStore = {
    setKeyPrefix: async (prefix) => void (settings.prefix = prefix),
    setSynchronize: async (sync) => void (settings.sync = sync),
    setDefaultKeychainAccess: async (access) => void (settings.access = access),
    get: async (key) => {
      await pause();
      if (failReads) throw new Error('keychain locked');
      return items.get(key) ?? null;
    },
    set: async (key, data, _convertDate, sync, access) => {
      await pause();
      calls.push({ key, data, sync, access });
      items.set(key, data);
    },
  };
  return Object.assign(storage, {
    items: items as Map<string, string>,
    calls,
    settings,
    failReads: (on: boolean) => void (failReads = on),
  });
}

describe('NativeShareRecordStore', () => {
  it('NativeShareRecordStore writes one keychain item, this device only, never synchronised', async () => {
    const fake = fakeSecureStore();
    const store = new NativeShareRecordStore(fake);
    await store.put(record('b1'));
    await store.put(record('b2'));
    await store.remove('b1');
    expect(fake.calls.at(-1)).toMatchObject({ key: 'shares', sync: false, access: KeychainAccess.afterFirstUnlockThisDeviceOnly });
    expect(JSON.parse(fake.items.get('shares')!).map((r: ShareRecord) => r.bookId)).toEqual(['b2']);
    expect(fake.settings).toEqual({ prefix: 'cicis-keys.', sync: false, access: KeychainAccess.afterFirstUnlockThisDeviceOnly });
    expect(new Set(fake.calls.map((c) => c.key))).toEqual(new Set(['shares']));
  });

  it('an unreadable keychain item reads as no records, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeSecureStore({ shares: '{not json' });
    const store = new NativeShareRecordStore(fake);
    expect(await store.list()).toEqual([]);
    expect(await store.get('b1')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an item the plugin calls invalid data reads as no records, and the next write replaces it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeSecureStore();
    const store = new NativeShareRecordStore(fake);
    const get = fake.get;
    fake.get = async () => {
      throw Object.assign(new Error('Invalid data'), { code: StorageErrorType.invalidData });
    };
    expect(await store.list()).toEqual([]);
    await store.put(record('b1'));
    fake.get = get;
    expect(await store.list()).toEqual([record('b1')]);
  });

  it('refuses to store a record that would not read back', async () => {
    const fake = fakeSecureStore();
    const store = new NativeShareRecordStore(fake);
    await expect(store.put({ ...record('b1'), appliedSeq: Number.NaN })).rejects.toThrow(TypeError);
    await expect(new WebShareRecordStore(new IDBFactory()).put({ ...record('b1'), role: 'admin' as 'owner' })).rejects.toThrow(TypeError);
    expect(fake.calls).toEqual([]);
  });

  it('an item that is not an array reads as no records, and the next write replaces it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeSecureStore({ shares: '{"v":1}' });
    const store = new NativeShareRecordStore(fake);
    expect(await store.list()).toEqual([]);
    await store.put(record('b1'));
    expect(await store.list()).toEqual([record('b1')]);
  });

  it('reads the records back, replaced by book id, from a later launch', async () => {
    const fake = fakeSecureStore();
    await new NativeShareRecordStore(fake).put(record('b1'));
    await new NativeShareRecordStore(fake).put(record('b1', { appliedSeq: 4 }));
    const again = new NativeShareRecordStore(fake);
    expect(await again.list()).toEqual([record('b1', { appliedSeq: 4 })]);
    expect(await again.get('b1')).toEqual(record('b1', { appliedSeq: 4 }));
    expect(await again.get('b2')).toBeNull();
  });

  it('two puts at once never lose one', async () => {
    const fake = fakeSecureStore({}, 5);
    const store = new NativeShareRecordStore(fake);
    await Promise.all([store.put(record('b1')), store.put(record('b2')), store.put(record('b3')), store.remove('b2')]);
    expect((await store.list()).map((r) => r.bookId).sort()).toEqual(['b1', 'b3']);
  });

  it('a failed write does not stop the next one', async () => {
    const fake = fakeSecureStore();
    const store = new NativeShareRecordStore(fake);
    fake.failReads(true);
    await expect(store.put(record('b1'))).rejects.toThrow();
    fake.failReads(false);
    await store.put(record('b2'));
    expect((await store.list()).map((r) => r.bookId)).toEqual(['b2']);
  });

  it('a keychain that cannot be read is never written over: the records there are kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeSecureStore({ shares: JSON.stringify([record('b1')]) });
    const store = new NativeShareRecordStore(fake);
    fake.failReads(true);
    expect(await store.list()).toEqual([]);
    await expect(store.put(record('b2'))).rejects.toThrow();
    await expect(store.remove('b1')).rejects.toThrow();
    fake.failReads(false);
    expect(await store.list()).toEqual([record('b1')]);
    expect(fake.calls).toEqual([]);
  });

  it('a write keeps the entries it cannot read (a later build’s record) as they were', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const later = { ...record('b9'), v: 2, more: 'x' };
    const fake = fakeSecureStore({ shares: JSON.stringify([later, record('b1')]) });
    const store = new NativeShareRecordStore(fake);
    expect(await store.list()).toEqual([record('b1')]);
    await store.put(record('b2'));
    await store.remove('b1');
    expect(JSON.parse(fake.items.get('shares')!)).toEqual([later, record('b2')]);
  });

  it('reads an item the plugin hands back already parsed', async () => {
    const fake = fakeSecureStore({ shares: [record('b1')] });
    expect(await new NativeShareRecordStore(fake).list()).toEqual([record('b1')]);
  });
});

describe('createShareRecordStore', () => {
  it('is the keychain inside the native shell and IndexedDB everywhere else', () => {
    native.value = true;
    expect(createShareRecordStore()).toBeInstanceOf(NativeShareRecordStore);
    native.value = false;
    expect(createShareRecordStore()).toBeInstanceOf(WebShareRecordStore);
  });
});
