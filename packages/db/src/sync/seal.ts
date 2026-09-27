import { sql } from 'drizzle-orm';
import type { Database, Db } from '../database';
import { aesGcmDecrypt, aesGcmEncrypt, AT_REST_INFO, deflate, fromUtf8, inflate, openSealedKey, randomBytes, sealKeyFor, utf8 } from './crypto';
import type { DeviceKeys } from './keys';
import { base64UrlToBytes, bytesToBase64Url, canonicalJson, verifySignature } from './relay-signing';
import type { ChangeSet, LogEntry, SealedFor } from './types';

/*
 * Sealing (spec §5.5, §6.6): a change-set becomes a `change` log entry — deflated, AES-GCM under the book's epoch key
 * bound to `bookId:epoch:deviceId`, and signed with this device's ECDSA key over the entry without its signature, keys
 * sorted. Every entry kind is signed the same way. Epoch keys live in `book_epoch_keys`, each sealed for this device's
 * own agreement key (§5.5), so a database copied anywhere else opens none of them.
 *
 * Sealing happens when the outbox drains, never at capture (controller ruling, task 5): the outbox keeps plaintext
 * change-sets, which the local database holds in the clear anyway, so a locked keychain never blocks a save and a
 * rotation between capture and drain seals under the newer key.
 */

export type ChangeLogEntry = Extract<LogEntry, { kind: 'change' }>;
export type UnsignedEntry = LogEntry extends infer E ? (E extends LogEntry ? Omit<E, 'sig'> : never) : never;

/** An entry's epoch key is not on this device: it joined after, or its keys did not survive a restore (§7.1, §8.7). */
export class MissingEpochKeyError extends Error {
  constructor(
    readonly bookId: string,
    readonly epoch: number,
  ) {
    super(`no key for epoch ${epoch} of book ${bookId} on this device`);
    this.name = 'MissingEpochKeyError';
  }
}

const entryAad = (bookId: string, epoch: number, deviceId: string) => utf8(`${bookId}:${epoch}:${deviceId}`);

/** The bytes an entry's `sig` covers: the entry without `sig` (and without what the relay adds), keys sorted (§6.6). */
export function entrySigningBytes(entry: UnsignedEntry | LogEntry | (LogEntry & { seq?: number; signJwk?: JsonWebKey })): Uint8Array {
  const { sig: _sig, seq: _seq, signJwk: _signJwk, ...rest } = entry as LogEntry & { seq?: number; signJwk?: JsonWebKey };
  return utf8(canonicalJson(rest));
}

export async function signEntry<U extends UnsignedEntry>(device: DeviceKeys, unsigned: U): Promise<U & { sig: string }> {
  const bytes = entrySigningBytes(unsigned);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.sign.privateKey, bytes as BufferSource));
  return { ...unsigned, sig: bytesToBase64Url(sig) };
}

/** Whether `entry.sig` verifies under `signJwk`. Never throws. */
export function verifyEntry(signJwk: JsonWebKey, entry: LogEntry): Promise<boolean> {
  return verifySignature(signJwk, entrySigningBytes(entry), entry.sig);
}

/** §6.6 under a key in hand: deflate, AES-GCM bound to `bookId:epoch:deviceId`, sign. What `Sealer.seal` does once it has the key. */
export async function sealChangeSet(device: DeviceKeys, key: Uint8Array, bookId: string, epoch: number, changeSet: ChangeSet): Promise<ChangeLogEntry> {
  const iv = randomBytes(12);
  const ct = await aesGcmEncrypt(key, iv, await deflate(utf8(JSON.stringify(changeSet))), entryAad(bookId, epoch, device.deviceId));
  return signEntry(device, { kind: 'change' as const, deviceId: device.deviceId, epoch, hlc: changeSet.hlc, iv: bytesToBase64Url(iv), ct: bytesToBase64Url(ct) });
}

/** The inverse of `sealChangeSet`. Throws on a wrong key or anything altered; checks no signature. */
export async function openChangeSet(key: Uint8Array, bookId: string, entry: ChangeLogEntry): Promise<ChangeSet> {
  const plain = await aesGcmDecrypt(key, base64UrlToBytes(entry.iv), base64UrlToBytes(entry.ct), entryAad(bookId, entry.epoch, entry.deviceId));
  return JSON.parse(fromUtf8(await inflate(plain))) as ChangeSet;
}

/** One device's sealing: its keys, and the epoch keys of every book it shares, opened on first use and kept in memory. */
export class Sealer {
  private readonly keys = new Map<string, Uint8Array>();

  constructor(
    private readonly database: Database,
    readonly device: DeviceKeys,
  ) {}

  get deviceId(): string {
    return this.device.deviceId;
  }

  /** The key of one epoch of a book, or null when this device does not have it or cannot open it (§8.7). */
  async epochKey(bookId: string, epoch: number, db: Db = this.database.db): Promise<Uint8Array | null> {
    const cacheKey = `${bookId}:${epoch}`;
    const cached = this.keys.get(cacheKey);
    if (cached) return cached;
    const [row] = await db.values<[string]>(sql`SELECT key_sealed FROM book_epoch_keys WHERE book_id = ${bookId} AND epoch = ${epoch}`);
    if (!row) return null;
    try {
      const key = await openSealedKey(this.device.agree.privateKey, bookId, JSON.parse(row[0]) as SealedFor, AT_REST_INFO);
      this.keys.set(cacheKey, key);
      return key;
    } catch {
      return null; // sealed for another device's key: a restored backup (§8.7)
    }
  }

  /** Every epoch key of the book this device holds, oldest first — what an invite hands on (§8.1 step 3). */
  async epochKeysOf(bookId: string): Promise<{ epoch: number; key: Uint8Array }[]> {
    const rows = await this.database.db.values<[number]>(sql`SELECT epoch FROM book_epoch_keys WHERE book_id = ${bookId} ORDER BY epoch`);
    const out: { epoch: number; key: Uint8Array }[] = [];
    for (const [epoch] of rows) {
      const key = await this.epochKey(bookId, Number(epoch));
      if (key) out.push({ epoch: Number(epoch), key });
    }
    return out;
  }

  /** Keeps an epoch key at rest (§5.5), sealed for this device's own agreement key. Keeps the first copy of an epoch. */
  async storeEpochKeyTx(tx: Db, bookId: string, epoch: number, key: Uint8Array): Promise<void> {
    const sealed = await sealKeyFor({ deviceId: this.deviceId, agreeJwk: this.device.public.agreeJwk }, bookId, epoch, key, AT_REST_INFO);
    await tx.run(sql`INSERT INTO book_epoch_keys (book_id, epoch, key_sealed) VALUES (${bookId}, ${epoch}, ${JSON.stringify(sealed)}) ON CONFLICT (book_id, epoch) DO NOTHING`);
    this.keys.set(`${bookId}:${epoch}`, key);
  }

  /** Forgets what it opened, so the next read goes to the database again (a restore replaced it). */
  forget(): void {
    this.keys.clear();
  }

  /** Encrypts and signs a change-set for `bookId` under `epoch` (§6.6). */
  async seal(bookId: string, epoch: number, changeSet: ChangeSet): Promise<ChangeLogEntry> {
    const key = await this.epochKey(bookId, epoch);
    if (!key) throw new MissingEpochKeyError(bookId, epoch);
    return sealChangeSet(this.device, key, bookId, epoch, changeSet);
  }

  /** Decrypts a `change` entry. Throws `MissingEpochKeyError` without its key, and on anything altered. Checks no signature. */
  async open(bookId: string, entry: ChangeLogEntry): Promise<ChangeSet> {
    const key = await this.epochKey(bookId, entry.epoch);
    if (!key) throw new MissingEpochKeyError(bookId, entry.epoch);
    return openChangeSet(key, bookId, entry);
  }

  /** Signs a `removal` or `rotation` entry as this device. */
  sign<U extends UnsignedEntry>(unsigned: U): Promise<U & { sig: string }> {
    return signEntry(this.device, unsigned);
  }
}
