import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { deviceKeysOf, exportDeviceJwks, generateKeyPairs, importDeviceJwks, type DeviceJwks, type DeviceKeys, type KeyStore } from '@expanses/db';
import { isNative } from '../lib/pwa';

/*
 * Where this device's keys live (spec §5.1, §5.2). Device-only: never synchronised, never in the database, never in a
 * backup — a restored or replaced phone is a new device and rejoins by invite (§8.7).
 *
 * - `WebKeyStore` — browsers, Playwright and the desktop web build: the two key pairs as **non-extractable**
 *   `CryptoKey`s in IndexedDB, database `cicis-keys`. The browser keeps the private keys; no script can read them out.
 * - `NativeKeyStore` — the Capacitor shell: the pairs as JWK in the platform keychain, through
 *   `@aparajita/capacitor-secure-storage`, with iOS class `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` and iCloud
 *   keychain sync off, so the item never leaves the phone or survives onto another. Loaded, the private keys are
 *   imported non-extractable.
 *
 * `createKeyStore()` picks one by `isNative()`.
 */

export const KEYS_DB = 'cicis-keys';
const STORE = 'device';
const RECORD = 'current';

interface StoredPairs {
  sign: CryptoKeyPair;
  agree: CryptoKeyPair;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class WebKeyStore implements KeyStore {
  private device: Promise<DeviceKeys> | undefined;

  constructor(private readonly idb: IDBFactory = globalThis.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    const req = this.idb.open(KEYS_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    return request(req);
  }

  private async read(): Promise<StoredPairs | undefined> {
    const db = await this.open();
    try {
      return (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD))) as StoredPairs | undefined;
    } finally {
      db.close();
    }
  }

  /** Writes the pairs only if none are there yet, in one transaction: two tabs racing at first launch keep one device. */
  private async writeOnce(pairs: StoredPairs): Promise<StoredPairs> {
    const db = await this.open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const existing = (await request(store.get(RECORD))) as StoredPairs | undefined;
      if (existing) return existing;
      await request(store.put(pairs, RECORD));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return pairs;
    } finally {
      db.close();
    }
  }

  getOrCreateDevice(): Promise<DeviceKeys> {
    this.device ??= (async () => {
      const stored = (await this.read()) ?? (await this.writeOnce(await generateKeyPairs(false)));
      return deviceKeysOf(stored.sign, stored.agree);
    })();
    this.device.catch(() => (this.device = undefined));
    return this.device;
  }

  async hasDevice(): Promise<boolean> {
    return (await this.read()) !== undefined;
  }
}

/** The slice of the secure-storage plugin `NativeKeyStore` uses, so tests can hand it a fake. */
export interface SecureStore {
  setKeyPrefix(prefix: string): Promise<void>;
  setSynchronize(sync: boolean): Promise<void>;
  setDefaultKeychainAccess(access: KeychainAccess): Promise<void>;
  get(key: string, convertDate?: boolean, sync?: boolean): Promise<unknown>;
  set(key: string, data: string, convertDate?: boolean, sync?: boolean, access?: KeychainAccess): Promise<void>;
}

const KEYCHAIN_PREFIX = 'cicis-keys.';
const KEYCHAIN_ITEM = 'device';

export class NativeKeyStore implements KeyStore {
  private device: Promise<DeviceKeys> | undefined;
  private ready: Promise<void> | undefined;

  constructor(private readonly storage: SecureStore = SecureStorage as unknown as SecureStore) {}

  /** Every item: this device only, readable after the first unlock (sync runs in the background), never in iCloud. */
  private configure(): Promise<void> {
    this.ready ??= (async () => {
      await this.storage.setKeyPrefix(KEYCHAIN_PREFIX);
      await this.storage.setSynchronize(false);
      await this.storage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
    })();
    return this.ready;
  }

  private async read(): Promise<DeviceJwks | undefined> {
    await this.configure();
    const raw = await this.storage.get(KEYCHAIN_ITEM, false, false);
    if (raw === null || raw === undefined) return undefined;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as DeviceJwks;
  }

  getOrCreateDevice(): Promise<DeviceKeys> {
    this.device ??= (async () => {
      const existing = await this.read();
      if (existing) return importDeviceJwks(existing);
      // The keychain holds strings, so the pairs are made extractable once, written, and imported back without it.
      const { sign, agree } = await generateKeyPairs(true);
      const jwks = await exportDeviceJwks(sign, agree);
      await this.storage.set(KEYCHAIN_ITEM, JSON.stringify(jwks), false, false, KeychainAccess.afterFirstUnlockThisDeviceOnly);
      return importDeviceJwks(jwks);
    })();
    this.device.catch(() => (this.device = undefined));
    return this.device;
  }

  async hasDevice(): Promise<boolean> {
    return (await this.read()) !== undefined;
  }
}

/** The key store for where the app runs (§5.2). */
export function createKeyStore(): KeyStore {
  return isNative() ? new NativeKeyStore() : new WebKeyStore();
}
