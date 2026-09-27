import { inviteSignedByAnOwner } from '../../../packages/db/src/sync/relay-signing';
import type { ClaimResult, DevicePublic, InviteRecord, LogEntry, Sealed, SequencedEntry } from '../../../packages/db/src/sync/types';
import { verifyEntitlement } from './entitlement';

/*
 * One book's relay state and every rule over it (spec §9.2, §9.3) — `MemoryTransport`'s `BookState` and methods
 * (packages/db/src/sync/memory-transport.ts) ported onto Durable Object storage, check for check and in the same
 * order, so the Worker reaches the outcomes the in-memory reference reaches. It knows nothing of HTTP: the Durable
 * Object authenticates the caller (§9.1) and hands this class a verified device id.
 *
 * Storage keys — the §9.3 state, one key per row so an append writes three small values, never the whole log:
 *   meta                       { bookId, epoch, seq, owners, deleted }
 *   device:<deviceId>          { signJwk, agreeJwk, addedAt, removedAt? }
 *   log:<seq, zero-padded>     LogEntry
 *   seen:<deviceId>:<hlc>      seq
 *   invite:<inviteId>          InviteRecord & { claimedAt? }
 */

export const MAX_ENTRY_BYTES = 128 * 1024;
export const MAX_ACTIVE_DEVICES = 5;
export const MAX_PULL_ENTRIES = 500;

/** The slice of `DurableObjectStorage` this class uses — small enough to fake in a test. */
export interface BookStore {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  list<T>(options: { prefix: string; start?: string; limit?: number }): Promise<Map<string, T>>;
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
}

type StoredInvite = InviteRecord & { claimedAt?: string };

const logKey = (seq: number) => `log:${String(seq).padStart(15, '0')}`;
const deviceKey = (deviceId: string) => `device:${deviceId}`;
const seenKey = (deviceId: string, hlc: string) => `seen:${deviceId}:${hlc}`;
const inviteKey = (inviteId: string) => `invite:${inviteId}`;

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

  async create(bookId: string, device: DevicePublic, deviceId: string): Promise<{ bookId: string }> {
    if (await this.store.get<Meta>('meta')) throw new RelayError(409, 'book already exists');
    const meta: Meta = { bookId, epoch: 1, seq: 0, owners: [deviceId], deleted: false };
    const record: DeviceRecord = { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: this.now().toISOString() };
    await this.store.put({ meta, [deviceKey(deviceId)]: record });
    return { bookId };
  }

  /** 404 no book, 410 deleted — `MemoryTransport.requireBook`. */
  async requireBook(): Promise<Meta> {
    const meta = await this.store.get<Meta>('meta');
    if (!meta) throw new RelayError(404, 'no such book');
    if (meta.deleted) throw new RelayError(410, 'this book is no longer shared');
    return meta;
  }

  /**
   * The signing key to verify a member's request against: 401 for a device the book never had or has removed —
   * `MemoryTransport.requireMember`. Book checks (404/410) come first, as there.
   */
  async memberKey(actor: string): Promise<JsonWebKey> {
    await this.requireBook();
    const device = await this.store.get<DeviceRecord>(deviceKey(actor));
    if (!device || device.removedAt) throw new RelayError(401, 'unknown or removed device');
    return device.signJwk;
  }

  private async requireMember(actor: string): Promise<Meta> {
    await this.memberKey(actor);
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
    await this.store.put({ meta: { ...meta, deleted: true } });
  }

  /** The invite's `sig` verifies under the pinned signing key of one of the book's current owners (spec §5.4). */
  private signedByAnOwner(invite: StoredInvite, owners: string[]): Promise<boolean> {
    return inviteSignedByAnOwner(invite, owners, (owner) => this.store.get<DeviceRecord>(deviceKey(owner)));
  }
}
