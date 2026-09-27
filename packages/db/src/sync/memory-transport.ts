import { uuidv7 } from '@expanses/core';
import { stubSign } from './seal';
import type { ClaimResult, DevicePublic, InviteRecord, LogEntry, Sealed, SequencedEntry, SyncTransport } from './types';
import { SyncTransportError } from './types';

/*
 * The relay's semantics, in memory (spec §9.2, §9.3). This is the reference `RelayTransport` (task 6) must match:
 * same durable-object-shaped state per book, same statuses, same replay and rotation rules. Its methods carry one
 * extra, optional `actorDeviceId` beyond `SyncTransport`'s own signature (still assignable to it — an extra
 * optional parameter never breaks the interface): the real relay reads the caller off signed HTTP headers
 * (spec §9.1), which this in-process stand-in has no request to read, so a caller passes the acting device
 * explicitly instead. Omitting it skips authorisation, which only tests calling `MemoryTransport` directly (not
 * through the `SyncTransport` type) can do.
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

export class MemoryTransport implements SyncTransport {
  private readonly books = new Map<string, BookState>();

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

  async createBook(device: DevicePublic): Promise<{ bookId: string }> {
    const deviceId = await deviceIdOf(device);
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

  async append(bookId: string, entry: LogEntry, actorDeviceId?: string): Promise<{ seq: number }> {
    const state = this.requireBook(bookId);
    this.requireMember(state, actorDeviceId ?? entry.deviceId);

    const dedupeKey = `${entry.deviceId}:${entry.hlc}`;
    const already = state.seen.get(dedupeKey);
    // A duplicate (deviceId, hlc) is success, not an error (spec §3's `append` comment, §9.1 "Replay").
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

  async pull(bookId: string, since: number, actorDeviceId?: string): Promise<{ entries: SequencedEntry[]; latest: number }> {
    const state = this.requireBook(bookId);
    if (actorDeviceId !== undefined) this.requireMember(state, actorDeviceId);

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

  async putInvite(bookId: string, invite: InviteRecord, actorDeviceId?: string): Promise<void> {
    const state = this.requireBook(bookId);
    if (actorDeviceId !== undefined) this.requireOwner(state, actorDeviceId);
    state.invites.set(invite.inviteId, { ...invite });
  }

  async previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    const found = this.findInvite(inviteId);
    if (!found) throw new SyncTransportError(404, 'no such invite');
    const { state, invite } = found;
    if (state.deleted) throw new SyncTransportError(410, 'this book is no longer shared');
    return { preview: invite.preview, expiresAt: invite.expiresAt, claimed: invite.claimedAt !== undefined };
  }

  async claimInvite(inviteId: string, device: DevicePublic): Promise<ClaimResult> {
    const found = this.findInvite(inviteId);
    if (!found) throw new SyncTransportError(404, 'no such invite');
    const { bookId, state, invite } = found;
    if (state.deleted) throw new SyncTransportError(410, 'this book is no longer shared');
    if (invite.claimedAt !== undefined) throw new SyncTransportError(409, 'invite already claimed');
    if (Date.parse(invite.expiresAt) <= Date.now()) throw new SyncTransportError(410, 'invite expired');
    if (!verifyOwnerSig(invite.sig, state.owners)) throw new SyncTransportError(403, 'bad owner signature');

    const activeDevices = [...state.devices.values()].filter((d) => d.removedAt === undefined).length;
    if (activeDevices >= MAX_ACTIVE_DEVICES) throw new SyncTransportError(429, 'this book already has five devices');

    const deviceId = await deviceIdOf(device);
    const now = new Date().toISOString();
    state.devices.set(deviceId, { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: now });
    invite.claimedAt = now;

    return { bookId, epoch: state.epoch, keys: invite.keys, sameMember: invite.sameMember, memberId: invite.memberId ?? deviceId };
  }

  async removeDevice(bookId: string, deviceId: string, actorDeviceId?: string): Promise<void> {
    const state = this.requireBook(bookId);
    if (actorDeviceId !== undefined) {
      // By an owner, for any device; by any device, for itself (spec §8.4).
      if (actorDeviceId === deviceId) this.requireMember(state, actorDeviceId);
      else this.requireOwner(state, actorDeviceId);
    }
    const device = state.devices.get(deviceId);
    if (!device) throw new SyncTransportError(404, 'no such device');
    device.removedAt = new Date().toISOString();
    state.owners.delete(deviceId);
  }

  async setOwners(bookId: string, deviceIds: string[], actorDeviceId?: string): Promise<void> {
    const state = this.requireBook(bookId);
    if (actorDeviceId !== undefined) this.requireOwner(state, actorDeviceId);
    state.owners = new Set(deviceIds);
  }

  async deleteBook(bookId: string, actorDeviceId?: string): Promise<void> {
    const state = this.requireBook(bookId);
    if (actorDeviceId !== undefined) this.requireOwner(state, actorDeviceId);
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

export { stubSign };
