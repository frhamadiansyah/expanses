import { IDBFactory } from 'fake-indexeddb';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { deviceIdOf } from '@expanses/db';
import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
vi.mock('../lib/pwa', () => ({ isNative: () => native.value }));

import { createKeyStore, KEYS_DB, NativeKeyStore, WebKeyStore, type SecureStore } from './key-store';

/*
 * §5.2: the device's keys, made once and kept on this device only. The web store keeps non-extractable CryptoKeys in
 * IndexedDB `cicis-keys` (fake-indexeddb here); the native store keeps JWK in the keychain as
 * kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly with iCloud sync off (the plugin is faked here — no simulator).
 */

describe('WebKeyStore', () => {
  it('makes the device once, in cicis-keys, with private keys no script can extract', async () => {
    const idb = new IDBFactory();
    const store = new WebKeyStore(idb);
    expect(await store.hasDevice()).toBe(false);
    const device = await store.getOrCreateDevice();
    expect(device.deviceId).toBe(await deviceIdOf(device.public));
    expect(device.sign.privateKey.extractable).toBe(false);
    expect(device.agree.privateKey.extractable).toBe(false);
    expect(await store.hasDevice()).toBe(true);
    const names = (await idb.databases()).map((d) => d.name);
    expect(names).toEqual([KEYS_DB]);
  });

  it('a later launch (a new store over the same IndexedDB) is the same device', async () => {
    const idb = new IDBFactory();
    const first = await new WebKeyStore(idb).getOrCreateDevice();
    const again = await new WebKeyStore(idb).getOrCreateDevice();
    expect(again.deviceId).toBe(first.deviceId);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, again.sign.privateKey, new Uint8Array([1, 2, 3]));
    await expect(crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, first.sign.publicKey, sig, new Uint8Array([1, 2, 3]))).resolves.toBe(true);
  });

  it('two tabs launching at once end with one device', async () => {
    const idb = new IDBFactory();
    const [a, b] = await Promise.all([new WebKeyStore(idb).getOrCreateDevice(), new WebKeyStore(idb).getOrCreateDevice()]);
    expect(a.deviceId).toBe(b.deviceId);
  });
});

function fakeKeychain() {
  const items = new Map<string, { value: string; access?: KeychainAccess; sync?: boolean }>();
  const settings: { prefix?: string; sync?: boolean; access?: KeychainAccess } = {};
  const storage: SecureStore = {
    setKeyPrefix: async (prefix) => void (settings.prefix = prefix),
    setSynchronize: async (sync) => void (settings.sync = sync),
    setDefaultKeychainAccess: async (access) => void (settings.access = access),
    get: async (key) => items.get(`${settings.prefix}${key}`)?.value ?? null,
    set: async (key, data, _convertDate, sync, access) => void items.set(`${settings.prefix}${key}`, { value: data, access, sync }),
  };
  return { storage, items, settings };
}

describe('NativeKeyStore', () => {
  it('keeps the pairs in the keychain on this device only, after first unlock, never in iCloud', async () => {
    const keychain = fakeKeychain();
    const store = new NativeKeyStore(keychain.storage);
    expect(await store.hasDevice()).toBe(false);
    const device = await store.getOrCreateDevice();
    expect(keychain.settings).toEqual({ prefix: 'cicis-keys.', sync: false, access: KeychainAccess.afterFirstUnlockThisDeviceOnly });
    const [item] = [...keychain.items.values()];
    expect(item).toMatchObject({ access: KeychainAccess.afterFirstUnlockThisDeviceOnly, sync: false });
    expect(device.sign.privateKey.extractable).toBe(false);
    expect(device.agree.privateKey.extractable).toBe(false);
    expect(device.deviceId).toBe(await deviceIdOf(device.public));
    expect(await store.hasDevice()).toBe(true);
  });

  it('a later launch reads the same device back', async () => {
    const keychain = fakeKeychain();
    const first = await new NativeKeyStore(keychain.storage).getOrCreateDevice();
    const again = await new NativeKeyStore(keychain.storage).getOrCreateDevice();
    expect(again.deviceId).toBe(first.deviceId);
    expect(again.public).toEqual(first.public);
  });
});

describe('createKeyStore', () => {
  it('is the keychain inside the native shell and IndexedDB everywhere else', () => {
    native.value = true;
    expect(createKeyStore()).toBeInstanceOf(NativeKeyStore);
    native.value = false;
    expect(createKeyStore()).toBeInstanceOf(WebKeyStore);
  });
});
