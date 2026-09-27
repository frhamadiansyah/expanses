import { uuidv7 } from '@expanses/core';
import { stubSign } from './seal';
import type { ClaimResult, DevicePublic, InviteRecord, LogEntry, Sealed, SequencedEntry, SyncTransport } from './types';
import { SyncTransportError } from './types';

/*
 * The relay's semantics, in memory (spec §9.2, §9.3). This is the reference `RelayTransport` (task 6) must match:
 * same durable-object-shaped state per book, same statuses, same replay and rotation rules.
 *
 * `MemoryTransport` itself is not a `SyncTransport` — it is the shared relay, holding every book's state. A caller
 * gets a `SyncTransport` bound to its own device identity via `relay.as(deviceId)`, mirroring how the real relay
 * gets the caller off signed HTTP headers (spec §9.1) rather than a parameter the caller could omit. Every method
 * on the bound client always authorises; there is no way to reach the relay's state without going through it, so
 * a caller holding only the `SyncTransport` type (every caller other than a test) cannot skip authorisation the
 * way an earlier version of this file allowed via an optional parameter.
 */

const MAX_ENTRY_BYTES = 128 * 1024;
const MAX_ACTIVE_DEVICES = 5;
const MAX_PULL_ENTRIES = 500;

interface DeviceRecord {
  signJwk: JsonWebKey;
  agreeJwk: JsonWebKey;
  addedAt: string;
  removedAt?: string;
}

interface StoredInvite extends InviteRecord {
  claimedAt?: string;
}

interface BookState {
  devices: Map<string, DeviceRecord>;
  owners: Set<string>;
  epoch: number;
  seq: number;
  log: Map<number, LogEntry>;
  /** `deviceId + ':' + hlc` -> the seq it was given, so a duplicate append can answer with the original seq. */
  seen: Map<string, number>;
  invites: Map<string, StoredInvite>;
  deleted: boolean;
}

/**
 * A device id derived from its public signing key, standing in for spec §5.1's `hex(SHA-256(raw public signing
 * key))[0:32]` until a real `KeyStore` (task 5) generates the key and derives the id from its raw bytes. Exported
 * so tests can compute the same id a fixture `DevicePublic` will be given.
 */
export async function deviceIdOf(device: DevicePublic): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(device.signJwk));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 32);
}

function verifyOwnerSig(sig: string, owners: ReadonlySet<string>): boolean {
  const marker = 'stub-sig:';
  return sig.startsWith(marker) && owners.has(sig.slice(marker.length));
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export class MemoryTransport {
  private readonly books = new Map<string, BookState>();

  /** A `SyncTransport` acting as `deviceId` — every call it makes is authorised against that identity. */
  as(deviceId: string): SyncTransport {
    return new BoundTransport(this, deviceId);
  }

  /** Test-only lookup so a fixture book can be inspected without a repository layer around it. */
  peek(bookId: string): Readonly<BookState> | undefined {
    return this.books.get(bookId);
  }

  private requireBook(bookId: string): BookState {
    const state = this.books.get(bookId);
    if (!state) throw new SyncTransportError(404, `no such book ${bookId}`);
    if (state.deleted) throw new SyncTransportError(410, 'this book is no longer shared');
    return state;
  }

  private requireMember(state: BookState, actor: string): void {
    const device = state.devices.get(actor);
    if (!device || device.removedAt) throw new SyncTransportError(401, 'unknown or removed device');
  }

  private requireOwner(state: BookState, actor: string): void {
    this.requireMember(state, actor);
    if (!state.owners.has(actor)) throw new SyncTransportError(403, 'owner only');
  }

  /** `callerDeviceId` must be the id its own `device` derives to — the relay verifies a new device against the JWK in its own body (spec §9.1), never a claim it takes on faith. */
  async createBook(device: DevicePublic, callerDeviceId: string): Promise<{ bookId: string }> {
    const deviceId = await deviceIdOf(device);
    if (deviceId !== callerDeviceId) throw new SyncTransportError(403, 'a device can only register itself');
    const bookId = uuidv7();
    const now = new Date().toISOString();
    this.books.set(bookId, {
      devices: new Map([[deviceId, { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: now }]]),
      owners: new Set([deviceId]),
      epoch: 1,
      seq: 0,
      log: new Map(),
      seen: new Map(),
      invites: new Map(),
      deleted: false,
    });
    return { bookId };
  }

  async append(bookId: string, entry: LogEntry, actorDeviceId: string): Promise<{ seq: number }> {
    const state = this.requireBook(bookId);
    this.requireMember(state, actorDeviceId);
    // A device only ever authors its own entries — never on another device's behalf (finding: bound identity).
    if (entry.deviceId !== actorDeviceId) throw new SyncTransportError(403, 'a device can only append its own entries');

    const dedupeKey = `${entry.deviceId}:${entry.hlc}`;
    const already = state.seen.get(dedupeKey);
    // A duplicate (deviceId, hlc) answers with the original seq — success, not an error (spec §3, §9.1 "Replay").
    // 409 on append is reserved for a rotation whose epoch is not current + 1.
    if (already !== undefined) return { seq: already };

    if (byteSize(entry) > MAX_ENTRY_BYTES) throw new SyncTransportError(413, 'entry over 128 KB');
    if (entry.kind === 'rotation' && entry.epoch !== state.epoch + 1) {
      throw new SyncTransportError(409, 'a rotation must raise the epoch by exactly one');
    }

    const seq = state.seq + 1;
    state.seq = seq;
    state.log.set(seq, entry);
    state.seen.set(dedupeKey, seq);
    if (entry.kind === 'rotation') state.epoch = entry.epoch;
    return { seq };
  }

  async pull(bookId: string, since: number, actorDeviceId: string): Promise<{ entries: SequencedEntry[]; latest: number }> {
    const state = this.requireBook(bookId);
    this.requireMember(state, actorDeviceId);

    const entries = [...state.log.entries()]
      .filter(([seq]) => seq > since)
      .sort(([a], [b]) => a - b)
      .slice(0, MAX_PULL_ENTRIES)
      .map(([seq, entry]): SequencedEntry => ({
        ...entry,
        seq,
        signJwk: state.devices.get(entry.deviceId)?.signJwk ?? {},
      }));
    return { entries, latest: state.seq };
  }

  async putInvite(bookId: string, invite: InviteRecord, actorDeviceId: string): Promise<void> {
    const state = this.requireBook(bookId);
    this.requireOwner(state, actorDeviceId);
    state.invites.set(invite.inviteId, { ...invite });
  }

  async previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    const found = this.findInvite(inviteId);
    if (!found) throw new SyncTransportError(404, 'no such invite');
    const { state, invite } = found;
    if (state.deleted) throw new SyncTransportError(410, 'this book is no longer shared');
    return { preview: invite.preview, expiresAt: invite.expiresAt, claimed: invite.claimedAt !== undefined };
  }

  /** `callerDeviceId` must be the id its own `device` derives to, exactly as `createBook` requires. */
  async claimInvite(inviteId: string, device: DevicePublic, callerDeviceId: string): Promise<ClaimResult> {
    const deviceId = await deviceIdOf(device);
    if (deviceId !== callerDeviceId) throw new SyncTransportError(403, 'a device can only claim as itself');

    const found = this.findInvite(inviteId);
    if (!found) throw new SyncTransportError(404, 'no such invite');
    const { bookId, state, invite } = found;
    if (state.deleted) throw new SyncTransportError(410, 'this book is no longer shared');
    if (invite.claimedAt !== undefined) throw new SyncTransportError(409, 'invite already claimed');
    if (Date.parse(invite.expiresAt) <= Date.now()) throw new SyncTransportError(410, 'invite expired');
    if (!verifyOwnerSig(invite.sig, state.owners)) throw new SyncTransportError(403, 'bad owner signature');

    const activeDevices = [...state.devices.values()].filter((d) => d.removedAt === undefined).length;
    if (activeDevices >= MAX_ACTIVE_DEVICES) throw new SyncTransportError(429, 'this book already has five devices');

    const now = new Date().toISOString();
    state.devices.set(deviceId, { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: now });
    invite.claimedAt = now;

    return { bookId, epoch: state.epoch, keys: invite.keys, sameMember: invite.sameMember, memberId: invite.memberId ?? deviceId };
  }

  async removeDevice(bookId: string, targetDeviceId: string, actorDeviceId: string): Promise<void> {
    const state = this.requireBook(bookId);
    // By an owner, for any device; by any device, for itself (spec §8.4).
    if (actorDeviceId === targetDeviceId) this.requireMember(state, actorDeviceId);
    else this.requireOwner(state, actorDeviceId);

    const device = state.devices.get(targetDeviceId);
    if (!device) throw new SyncTransportError(404, 'no such device');
    device.removedAt = new Date().toISOString();
    state.owners.delete(targetDeviceId);
  }

  async setOwners(bookId: string, deviceIds: string[], actorDeviceId: string): Promise<void> {
    const state = this.requireBook(bookId);
    this.requireOwner(state, actorDeviceId);
    state.owners = new Set(deviceIds);
  }

  async deleteBook(bookId: string, actorDeviceId: string): Promise<void> {
    const state = this.requireBook(bookId);
    this.requireOwner(state, actorDeviceId);
    state.deleted = true;
  }

  private findInvite(inviteId: string): { bookId: string; state: BookState; invite: StoredInvite } | undefined {
    for (const [bookId, state] of this.books.entries()) {
      const invite = state.invites.get(inviteId);
      if (invite) return { bookId, state, invite };
    }
    return undefined;
  }
}

/** A `SyncTransport` bound to one device identity, so every call it makes is authorised as that device — never skippable. */
class BoundTransport implements SyncTransport {
  constructor(
    private readonly relay: MemoryTransport,
    private readonly deviceId: string,
  ) {}

  createBook(device: DevicePublic): Promise<{ bookId: string }> {
    return this.relay.createBook(device, this.deviceId);
  }

  append(bookId: string, entry: LogEntry): Promise<{ seq: number }> {
    return this.relay.append(bookId, entry, this.deviceId);
  }

  pull(bookId: string, since: number): Promise<{ entries: SequencedEntry[]; latest: number }> {
    return this.relay.pull(bookId, since, this.deviceId);
  }

  putInvite(bookId: string, invite: InviteRecord): Promise<void> {
    return this.relay.putInvite(bookId, invite, this.deviceId);
  }

  previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    return this.relay.previewInvite(inviteId);
  }

  claimInvite(inviteId: string, device: DevicePublic): Promise<ClaimResult> {
    return this.relay.claimInvite(inviteId, device, this.deviceId);
  }

  removeDevice(bookId: string, deviceId: string): Promise<void> {
    return this.relay.removeDevice(bookId, deviceId, this.deviceId);
  }

  setOwners(bookId: string, deviceIds: string[]): Promise<void> {
    return this.relay.setOwners(bookId, deviceIds, this.deviceId);
  }

  deleteBook(bookId: string): Promise<void> {
    return this.relay.deleteBook(bookId, this.deviceId);
  }
}

export { stubSign };
