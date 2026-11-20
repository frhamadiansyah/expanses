import { inviteSignedByAnOwner } from '../../../packages/db/src/sync/relay-signing';
import type { ClaimResult, DevicePublic, InviteRecord, LogEntry, Sealed, SequencedEntry } from '../../../packages/db/src/sync/types';
import { verifyEntitlement } from './entitlement';
import { MAX_BLOB_BYTES, MAX_BLOB_TTL_MS, MAX_BOOK_BLOB_BYTES } from '../../../packages/db/src/self/transport';
import { base64UrlToBytes, sha256Hex } from '../../../packages/db/src/sync/relay-signing';

/*
 * One book's relay state and every rule over it (spec §9.2, §9.3) — `MemoryTransport`'s `BookState` and methods
 * (packages/db/src/sync/memory-transport.ts) ported onto Durable Object storage, check for check and in the same
 * order, so the Worker reaches the outcomes the in-memory reference reaches. It knows nothing of HTTP: the Durable
 * Object authenticates the caller (§9.1) and hands this class a verified device id.
 *
 * Storage keys — the §9.3 state, one key per row so an append writes three small values, never the whole log:
 *   meta                       { bookId, epoch, seq, owners, deleted, deletedBy? }
 *   device:<deviceId>          { signJwk, agreeJwk, addedAt, removedAt? }
 *   log:<seq, zero-padded>     LogEntry
 *   seen:<deviceId>:<hlc>      seq
 *   invite:<inviteId>          InviteRecord & { claimedAt? }
 *   ack:<deviceId>             seq — a self book's (link my devices): how far that device has applied the log
 *   blob:<hash>                { data, expiresAt, size } — the copy a new device starts from, its photos
 */

export const MAX_ENTRY_BYTES = 128 * 1024;
export const MAX_ACTIVE_DEVICES = 5;
export const MAX_PULL_ENTRIES = 500;

/** The slice of `DurableObjectStorage` this class uses — small enough to fake in a test. */
export interface BookStore {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  list<T>(options: { prefix: string; start?: string; limit?: number }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<number>;
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** More the answer's body carries beside `error`: a deleted book's `410` names who deleted it (§8.6). */
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface DeviceRecord {
  signJwk: JsonWebKey;
  agreeJwk: JsonWebKey;
  addedAt: string;
  removedAt?: string;
}

interface Meta {
  bookId: string;
  epoch: number;
  seq: number;
  owners: string[];
  deleted: boolean;
  /** The owner device that deleted the book (§8.6, task 9a): every later `410` names it. */
  deletedBy?: string;
  /** The owner's own book (link my devices): every device an owner, the log pruned below every device's ack. */
  self?: boolean;
  /** Entries up to this seq were pruned. */
  prunedThrough?: number;
  /** Bytes of every blob kept. */
  blobBytes?: number;
}

type StoredInvite = InviteRecord & { claimedAt?: string };

const logKey = (seq: number) => `log:${String(seq).padStart(15, '0')}`;
const deviceKey = (deviceId: string) => `device:${deviceId}`;
const seenKey = (deviceId: string, hlc: string) => `seen:${deviceId}:${hlc}`;
const inviteKey = (inviteId: string) => `invite:${inviteId}`;
const ackKey = (deviceId: string) => `ack:${deviceId}`;
const blobKey = (hash: string) => `blob:${hash}`;

interface StoredBlob {
  data: string;
  expiresAt: number;
  size: number;
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export class Book {
  constructor(
    private readonly store: BookStore,
    /** Records that `inviteId` lives in `bookId`; false when another book already holds that id. */
    private readonly indexInvite: (inviteId: string, bookId: string) => Promise<boolean>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(bookId: string, device: DevicePublic, deviceId: string, options: { self?: boolean } = {}): Promise<{ bookId: string }> {
    if (await this.store.get<Meta>('meta')) throw new RelayError(409, 'book already exists');
    const meta: Meta = { bookId, epoch: 1, seq: 0, owners: [deviceId], deleted: false, ...(options.self ? { self: true, prunedThrough: 0, blobBytes: 0 } : {}) };
    const record: DeviceRecord = { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: this.now().toISOString() };
    await this.store.put({ meta, [deviceKey(deviceId)]: record, ...(options.self ? { [ackKey(deviceId)]: 0 } : {}) });
    return { bookId };
  }

  /** A self book: this device has applied up to `seq`; what every active device has applied goes — `MemoryTransport.ack`. */
  async ack(seq: number, actor: string): Promise<void> {
    const meta = await this.requireMember(actor);
    if (!meta.self) throw new RelayError(400, 'only a self book is pruned');
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > meta.seq) throw new RelayError(400, 'ack past the log');
    const mine = (await this.store.get<number>(ackKey(actor))) ?? 0;
    await this.store.put({ [ackKey(actor)]: Math.max(mine, seq) });
    const devices = await this.store.list<DeviceRecord>({ prefix: 'device:' });
    const acks = await this.store.list<number>({ prefix: 'ack:' });
    const active = [...devices.entries()].filter(([, d]) => d.removedAt === undefined).map(([key]) => key.slice('device:'.length));
    const floor = Math.min(...active.map((id) => acks.get(ackKey(id)) ?? 0));
    const from = meta.prunedThrough ?? 0;
    if (floor <= from) return;
    const keys: string[] = [];
    for (let at = from + 1; at <= floor; at += 1) keys.push(logKey(at));
    for (let i = 0; i < keys.length; i += 128) await this.store.delete(keys.slice(i, i + 128));
    const latest = (await this.store.get<Meta>('meta'))!;
    await this.store.put({ meta: { ...latest, prunedThrough: floor } });
  }

  async putBlob(hash: string, data: string, expiresAt: string, actor: string): Promise<void> {
    const meta = await this.requireMember(actor);
    let bytes: Uint8Array;
    try {
      bytes = base64UrlToBytes(data);
    } catch {
      throw new RelayError(400, 'expected base64url');
    }
    if (bytes.length > MAX_BLOB_BYTES) throw new RelayError(413, 'blob over 700 KB');
    if ((await sha256Hex(bytes)) !== hash) throw new RelayError(400, 'blob does not match its hash');
    const until = Date.parse(expiresAt);
    if (!Number.isFinite(until) || until > this.now().getTime() + MAX_BLOB_TTL_MS) throw new RelayError(400, 'a blob is kept a week at most');
    let used = meta.blobBytes ?? 0;
    const expired: string[] = [];
    for (const [key, blob] of await this.store.list<StoredBlob>({ prefix: 'blob:' })) {
      if (blob.expiresAt <= this.now().getTime()) {
        expired.push(key);
        used -= blob.size;
      }
    }
    for (let i = 0; i < expired.length; i += 128) await this.store.delete(expired.slice(i, i + 128));
    const before = await this.store.get<StoredBlob>(blobKey(hash));
    if (before && !expired.includes(blobKey(hash))) used -= before.size;
    if (used + bytes.length > MAX_BOOK_BLOB_BYTES) throw new RelayError(413, 'this book holds too much already');
    await this.store.put({ [blobKey(hash)]: { data, expiresAt: until, size: bytes.length }, meta: { ...meta, blobBytes: Math.max(0, used) + bytes.length } });
  }

  async getBlob(hash: string, actor: string): Promise<{ data: string }> {
    await this.requireMember(actor);
    const blob = await this.store.get<StoredBlob>(blobKey(hash));
    if (!blob || blob.expiresAt <= this.now().getTime()) throw new RelayError(404, 'no such blob');
    return { data: blob.data };
  }

  async deleteBlob(hash: string, actor: string): Promise<void> {
    const meta = await this.requireMember(actor);
    const blob = await this.store.get<StoredBlob>(blobKey(hash));
    if (!blob) return;
    await this.store.delete([blobKey(hash)]);
    await this.store.put({ meta: { ...meta, blobBytes: Math.max(0, (meta.blobBytes ?? 0) - blob.size) } });
  }

  /** 404 no book, 410 deleted — `MemoryTransport.requireBook`. */
  async requireBook(): Promise<Meta> {
    const meta = await this.store.get<Meta>('meta');
    if (!meta) throw new RelayError(404, 'no such book');
    if (meta.deleted) throw new RelayError(410, 'this book is no longer shared');
    return meta;
  }

  /**
   * A member's call on a deleted book (§8.6, fix round 1): null while the book stands. Otherwise the `410`, bare — and
   * naming the device that deleted it only when the caller is a device of the book, not removed, whose request
   * `verifies` against its stored key. Nothing about the book is told before the caller is authenticated.
   */
  async deletedAnswer(actor: string, verifies: (key: JsonWebKey) => Promise<boolean>): Promise<RelayError | null> {
    const meta = await this.store.get<Meta>('meta');
    if (!meta?.deleted) return null;
    const device = await this.store.get<DeviceRecord>(deviceKey(actor));
    const known = device !== undefined && !device.removedAt && meta.deletedBy !== undefined && (await verifies(device.signJwk));
    return new RelayError(410, 'this book is no longer shared', known ? { deletedBy: meta.deletedBy } : {});
  }

  /**
   * The signing key to verify a member's request against: 401 for a device the book never had —
   * `MemoryTransport.requireMember`. Book checks (404/410) come first, as there. A device the book has removed still
   * gets its key back, flagged: the caller verifies the signature under it and only then answers `403 removed`
   * (§8.4, final review I2), so nothing about the device is told to a request its key did not sign.
   */
  async memberKey(actor: string): Promise<{ signJwk: JsonWebKey; removed: boolean }> {
    await this.requireBook();
    const device = await this.store.get<DeviceRecord>(deviceKey(actor));
    if (!device) throw new RelayError(401, 'unknown device');
    return { signJwk: device.signJwk, removed: device.removedAt !== undefined };
  }

  private async requireMember(actor: string): Promise<Meta> {
    if ((await this.memberKey(actor)).removed) throw new RelayError(403, 'removed');
    return this.requireBook();
  }

  private async requireOwner(actor: string): Promise<Meta> {
    const meta = await this.requireMember(actor);
    if (!meta.owners.includes(actor)) throw new RelayError(403, 'owner only');
    return meta;
  }

  /** `201 { seq }` new, `200 { seq }` duplicate — the `created` flag tells the two apart. */
  async append(entry: LogEntry, actor: string): Promise<{ seq: number; created: boolean }> {
    const meta = await this.requireMember(actor);
    if (entry.deviceId !== actor) throw new RelayError(403, 'a device can only append its own entries');

    const already = await this.store.get<number>(seenKey(entry.deviceId, entry.hlc));
    if (already !== undefined) return { seq: already, created: false };

    if (byteSize(entry) > MAX_ENTRY_BYTES) throw new RelayError(413, 'entry over 128 KB');
    // A removal of another device needs an owner, as DELETE /devices does (spec §8.4, task 5 fix round 1).
    if (entry.kind === 'removal' && entry.target !== actor && !meta.owners.includes(actor)) throw new RelayError(403, 'only an owner removes another device');
    if (entry.kind === 'rotation' && entry.epoch !== meta.epoch + 1) {
      throw new RelayError(409, 'a rotation must raise the epoch by exactly one');
    }
    // A change sealed under an epoch the book has rotated past (final review, I1) — `MemoryTransport.append`.
    if (entry.kind === 'change' && entry.epoch < meta.epoch) throw new RelayError(409, 'stale epoch');
    if (meta.owners.includes(actor) && !(await verifyEntitlement(meta.bookId))) {
      throw new RelayError(402, 'this book is read-only until its owner renews');
    }

    const seq = meta.seq + 1;
    const next: Meta = { ...meta, seq, epoch: entry.kind === 'rotation' ? entry.epoch : meta.epoch };
    await this.store.put({ meta: next, [logKey(seq)]: entry, [seenKey(entry.deviceId, entry.hlc)]: seq });
    return { seq, created: true };
  }

  async pull(since: number, actor: string): Promise<{ entries: SequencedEntry[]; latest: number }> {
    const meta = await this.requireMember(actor);
    // A self book's start is gone once every device has read it — `MemoryTransport.pull`.
    if (since < (meta.prunedThrough ?? 0)) throw new RelayError(410, 'pruned');
    const rows = await this.store.list<LogEntry>({ prefix: 'log:', start: logKey(since + 1), limit: MAX_PULL_ENTRIES });
    const devices = await this.store.list<DeviceRecord>({ prefix: 'device:' });
    const entries = [...rows.entries()].map(([key, entry]): SequencedEntry => ({
      ...entry,
      seq: Number(key.slice('log:'.length)),
      signJwk: devices.get(deviceKey(entry.deviceId))?.signJwk ?? {},
    }));
    return { entries, latest: meta.seq };
  }

  async putInvite(invite: InviteRecord, actor: string): Promise<void> {
    const meta = await this.requireOwner(actor);
    if (!(await this.indexInvite(invite.inviteId, meta.bookId))) throw new RelayError(409, 'invite id already taken');
    await this.store.put({ [inviteKey(invite.inviteId)]: { ...invite } });
  }

  async previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    const invite = await this.store.get<StoredInvite>(inviteKey(inviteId));
    if (!invite) throw new RelayError(404, 'no such invite');
    await this.requireBook();
    return { preview: invite.preview, expiresAt: invite.expiresAt, claimed: invite.claimedAt !== undefined };
  }

  /** `deviceId` is already verified to be what `device` derives to, and to have signed the request. */
  async claimInvite(inviteId: string, device: DevicePublic, deviceId: string): Promise<ClaimResult> {
    const invite = await this.store.get<StoredInvite>(inviteKey(inviteId));
    if (!invite) throw new RelayError(404, 'no such invite');
    const meta = await this.requireBook();
    if (invite.claimedAt !== undefined) throw new RelayError(409, 'invite already claimed');
    if (Date.parse(invite.expiresAt) <= this.now().getTime()) throw new RelayError(410, 'invite expired');
    if (!(await this.signedByAnOwner(invite, meta.owners))) throw new RelayError(403, 'bad owner signature');

    const devices = await this.store.list<DeviceRecord>({ prefix: 'device:' });
    const active = [...devices.values()].filter((d) => d.removedAt === undefined).length;
    if (active >= MAX_ACTIVE_DEVICES) throw new RelayError(429, 'this book already has five devices');

    const now = this.now().toISOString();
    const record: DeviceRecord = { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: now };
    await this.store.put({ [deviceKey(deviceId)]: record, [inviteKey(inviteId)]: { ...invite, claimedAt: now } });
    // A self book: each of the owner's devices is an owner, and starts reading the log where it joined.
    if (meta.self) {
      await this.store.put({ meta: { ...meta, owners: [...new Set([...meta.owners, deviceId])] }, [ackKey(deviceId)]: meta.seq });
      return { bookId: meta.bookId, epoch: meta.epoch, keys: invite.keys, sameMember: invite.sameMember, memberId: invite.memberId ?? deviceId, seq: meta.seq };
    }
    return {
      bookId: meta.bookId,
      epoch: meta.epoch,
      keys: invite.keys,
      sameMember: invite.sameMember,
      memberId: invite.memberId ?? deviceId,
    };
  }

  async removeDevice(target: string, actor: string): Promise<void> {
    // By an owner, for any device; by any device, for itself (spec §8.4).
    const meta = actor === target ? await this.requireMember(actor) : await this.requireOwner(actor);
    const device = await this.store.get<DeviceRecord>(deviceKey(target));
    if (!device) throw new RelayError(404, 'no such device');
    await this.store.put({
      [deviceKey(target)]: { ...device, removedAt: this.now().toISOString() },
      meta: { ...meta, owners: meta.owners.filter((id) => id !== target) },
    });
  }

  async setOwners(deviceIds: string[], actor: string): Promise<void> {
    const meta = await this.requireOwner(actor);
    await this.store.put({ meta: { ...meta, owners: [...new Set(deviceIds)] } });
  }

  async deleteBook(actor: string): Promise<void> {
    const meta = await this.requireOwner(actor);
    await this.store.put({ meta: { ...meta, deleted: true, deletedBy: actor } });
  }

  /** The invite's `sig` verifies under the pinned signing key of one of the book's current owners (spec §5.4). */
  private signedByAnOwner(invite: StoredInvite, owners: string[]): Promise<boolean> {
    return inviteSignedByAnOwner(invite, owners, (owner) => this.store.get<DeviceRecord>(deviceKey(owner)));
  }
}
