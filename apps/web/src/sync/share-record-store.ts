import { KeychainAccess, SecureStorage, StorageErrorType } from '@aparajita/capacitor-secure-storage';
import { parseShareRecord, storableShareRecord, type ShareRecord, type ShareRecordStore } from '@expanses/db';
import { isNative } from '../lib/pwa';
import { configureKeychain, openKeysDb, SHARES_STORE, type SecureStore } from './key-store';

/*
 * Where this device's share records live (sharing resilience §6.1, D-B1): beside the device keys, outside the
 * database, so a lost or replaced database can still find its shares. Like the keys, this device only — never
 * synchronised, never in a backup.
 *
 * - `WebShareRecordStore` — IndexedDB `cicis-keys`, object store `shares` keyed by book id (database version 2).
 * - `NativeShareRecordStore` — one keychain item `cicis-keys.shares`, a JSON array, `afterFirstUnlockThisDeviceOnly`
 *   with iCloud keychain sync off.
 *
 * A record that does not read as a v1 record is left out of every read (and warned of once); a write never stores one.
 * `createShareRecordStore()` picks a store by `isNative()`.
 */

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Share record write aborted'));
  });
}

/** One console warning per store, however many unreadable records it meets. */
class Warner {
  private warned = false;
  warn(message: string, detail?: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(message, detail);
  }
}

export class WebShareRecordStore implements ShareRecordStore {
  private readonly warner = new Warner();

  constructor(private readonly idb: IDBFactory = globalThis.indexedDB) {}

  private async read<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openKeysDb(this.idb);
    try {
      return await request(run(db.transaction(SHARES_STORE, 'readonly').objectStore(SHARES_STORE)));
    } finally {
      db.close();
    }
  }

  private async write<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<void> {
    const db = await openKeysDb(this.idb);
    try {
      const tx = db.transaction(SHARES_STORE, 'readwrite');
      const done = complete(tx);
      await request(run(tx.objectStore(SHARES_STORE)));
      await done;
    } finally {
      db.close();
    }
  }

  private parse(raw: unknown): ShareRecord | null {
    const record = parseShareRecord(raw);
    if (!record) this.warner.warn('A stored share record could not be read; it is left out', raw);
    return record;
  }

  async list(): Promise<ShareRecord[]> {
    const raws = await this.read((store) => store.getAll());
    return raws.map((raw) => this.parse(raw)).filter((r): r is ShareRecord => r !== null);
  }

  async get(bookId: string): Promise<ShareRecord | null> {
    const raw = await this.read((store) => store.get(bookId));
    return raw === undefined ? null : this.parse(raw);
  }

  async put(record: ShareRecord): Promise<void> {
    const stored = storableShareRecord(record);
    await this.write((store) => store.put(stored));
  }

  async remove(bookId: string): Promise<void> {
    await this.write((store) => store.delete(bookId));
  }
}

const SHARES_ITEM = 'shares';

/** The item's entries could not be read because the keychain could not be (locked, an OS error): never written over. */
class KeychainUnavailable extends Error {}

export class NativeShareRecordStore implements ShareRecordStore {
  private readonly warner = new Warner();
  private ready: Promise<void> | undefined;
  /** Every read and write in turn: a write is a read-modify-write of the one item, so two never lose one. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: SecureStore = SecureStorage as unknown as SecureStore) {}

  private configure(): Promise<void> {
    this.ready ??= configureKeychain(this.storage);
    this.ready.catch(() => (this.ready = undefined));
    return this.ready;
  }

  private inTurn<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * The item's entries as stored, readable or not. An item that is not a JSON array is corrupt and reads as none (a
   * write then replaces it); a keychain that cannot be read at all throws `KeychainUnavailable`.
   */
  private async entries(): Promise<unknown[]> {
    let raw: unknown;
    try {
      await this.configure();
      raw = await this.storage.get(SHARES_ITEM, false, false);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== StorageErrorType.invalidData) {
        throw new KeychainUnavailable('The keychain could not be read', { cause: error });
      }
      this.warner.warn('The share records item could not be read; it reads as none', error);
      return [];
    }
    if (raw === null || raw === undefined) return [];
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        this.warner.warn('The share records item could not be read; it reads as none', error);
        return [];
      }
    }
    if (!Array.isArray(parsed)) {
      this.warner.warn('The share records item is not a list; it reads as none', parsed);
      return [];
    }
    return parsed;
  }

  private records(entries: unknown[]): ShareRecord[] {
    const out: ShareRecord[] = [];
    for (const entry of entries) {
      const record = parseShareRecord(entry);
      if (record) out.push(record);
      else this.warner.warn('A stored share record could not be read; it is left out', entry);
    }
    return out;
  }

  /** Never throws: a keychain that cannot be read reads as no records. */
  private async readAll(): Promise<ShareRecord[]> {
    try {
      return this.records(await this.inTurn(() => this.entries()));
    } catch (error) {
      this.warner.warn('The share records could not be read; they read as none', error);
      return [];
    }
  }

  /** Rewrites the item from its entries as stored; entries it cannot read (a later build's) are kept as they were. */
  private change(edit: (entries: unknown[]) => unknown[] | null): Promise<void> {
    return this.inTurn(async () => {
      const next = edit(await this.entries());
      if (next === null) return;
      await this.storage.set(SHARES_ITEM, JSON.stringify(next), false, false, KeychainAccess.afterFirstUnlockThisDeviceOnly);
    });
  }

  list(): Promise<ShareRecord[]> {
    return this.readAll();
  }

  async get(bookId: string): Promise<ShareRecord | null> {
    return (await this.readAll()).find((r) => r.bookId === bookId) ?? null;
  }

  async put(record: ShareRecord): Promise<void> {
    const stored = storableShareRecord(record);
    await this.change((entries) => [...entries.filter((e) => bookIdOf(e) !== stored.bookId), stored]);
  }

  remove(bookId: string): Promise<void> {
    return this.change((entries) => {
      const kept = entries.filter((e) => bookIdOf(e) !== bookId);
      return kept.length === entries.length ? null : kept;
    });
  }
}

function bookIdOf(entry: unknown): unknown {
  return typeof entry === 'object' && entry !== null ? (entry as { bookId?: unknown }).bookId : undefined;
}

/** The share record store for where the app runs (§6.1). */
export function createShareRecordStore(): ShareRecordStore {
  return isNative() ? new NativeShareRecordStore() : new WebShareRecordStore();
}
