import { uuidv7 } from '@expanses/core';
import { deviceIdOf, inviteSignedByAnOwner, MAX_CLOCK_SKEW_MS, requestSigningBytes, verifySignature, bytesToBase64Url, type RequestSigner } from './relay-signing';
import type { ClaimResult, DevicePublic, InviteRecord, LogEntry, Sealed, SealedFor, SequencedEntry, SyncTransport } from './types';
import { SyncTransportError } from './types';
import { LinkHub, LinkRefusal, type LinkStore, type LinkView } from '../self/link-hub';
import { MAX_BLOB_BYTES, MAX_BLOB_TTL_MS, MAX_BOOK_BLOB_BYTES, type SelfTransport } from '../self/transport';
import { base64UrlToBytes, sha256Hex } from './relay-signing';

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
  /** The owner's own relay book (link my devices): every device an owner, the log pruned below every device's ack. */
  self?: boolean;
  acks: Map<string, number>;
  /** Entries up to this seq were pruned (self books). */
  prunedThrough: number;
  blobs: Map<string, { data: string; expiresAt: number; size: number }>;
  deleted: boolean;
  /** The owner device that deleted the book (§8.6): every later `410` names it. */
  deletedBy?: string;
}

/** A deleted book's `410`: bare, naming the device that deleted it only to an authenticated device of the book (§8.6, §9.2). */
function gone(state: BookState, authenticated: boolean): SyncTransportError {
  return new SyncTransportError(410, 'this book is no longer shared', authenticated && state.deletedBy !== undefined ? { deletedBy: state.deletedBy } : {});
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** A map as the link hub's store, as a Durable Object's storage is on the relay. */
function mapStore(): LinkStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
    put: async (entries) => {
      for (const [key, value] of Object.entries(entries)) map.set(key, structuredClone(value));
    },
    delete: async (key) => map.delete(key),
  };
}

/** The link hub's refusal, as this relay's error. */
async function linked<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LinkRefusal) throw new SyncTransportError(error.status, error.message);
    throw error;
  }
}

export class MemoryTransport {
  private readonly books = new Map<string, BookState>();
  /** `now` is the hub's clock, so a test can run ten minutes forward. */
  readonly links: LinkHub;

  constructor(options: { now?: () => number } = {}) {
    this.links = new LinkHub(mapStore(), options.now ?? Date.now);
  }

  /**
   * A `SyncTransport` acting as one device — every call it makes is authorised against that identity. Given the
   * device's `RequestSigner`, each call is also signed and verified exactly as the relay does it (spec §9.1, with
   * relay-signing.ts): the §9.1 bytes, the 5-minute window, the pinned key of a member, the body's own key on
   * `createBook` and a claim; a refusal is the relay's `401`. Given only an id, the signature step is left out — for
   * tests of the relay's rules alone.
   */
  as(who: string | RequestSigner): SelfTransport {
    return typeof who === 'string' ? new BoundTransport(this, who) : new BoundTransport(this, who.deviceId, who);
  }

  /** §9.1 on a signed request: the window, then the key — the body's own on registration and claims, else the pinned one. */
  async verifyRequest(signed: SignedRequest, bookId: string | null, bodyKey: JsonWebKey | null): Promise<void> {
    if (Math.abs(Date.now() - signed.timestamp) > MAX_CLOCK_SKEW_MS) throw new SyncTransportError(401, 'timestamp outside the window');
    if (bodyKey && (await deviceIdOf({ signJwk: bodyKey }).catch(() => null)) !== signed.deviceId) {
      throw new SyncTransportError(403, 'a device can only register or claim as itself');
    }
    let key = bodyKey;
    if (!key && bookId !== null) {
      const deleted = this.books.get(bookId);
      if (deleted?.deleted) {
        // A deleted book (fix round 1): a bare 410, naming who deleted it only once this signature verifies against the
        // caller's pinned key — as the relay does.
        const device = deleted.devices.get(signed.deviceId);
        const verified = !!device && !device.removedAt && (await verifySignature(device.signJwk, signed.bytes, signed.signature));
        throw gone(deleted, verified);
      }
      const state = this.requireBook(bookId);
      const device = state.devices.get(signed.deviceId);
      if (!device) throw new SyncTransportError(401, 'unknown device');
      key = device.signJwk;
      // A removed device is told so (final review, I2) — but only once its own key signed the request, as the relay does.
      if (device.removedAt) {
        if (!(await verifySignature(key, signed.bytes, signed.signature))) throw new SyncTransportError(401, 'bad signature');
        throw new SyncTransportError(403, 'removed');
      }
    }
    if (!key || !(await verifySignature(key, signed.bytes, signed.signature))) throw new SyncTransportError(401, 'bad signature');
  }

  /** Test-only lookup so a fixture book can be inspected without a repository layer around it. */
  peek(bookId: string): Readonly<BookState> | undefined {
    return this.books.get(bookId);
  }

  requireBook(bookId: string): BookState {
    const state = this.books.get(bookId);
    if (!state) throw new SyncTransportError(404, `no such book ${bookId}`);
    if (state.deleted) throw gone(state, false);
    return state;
  }

  /**
   * `requireBook` for a member's call: a deleted book's 410 names who deleted it to a caller that is one of its
   * devices (the bound identity; a signed call was already checked in `verifyRequest`), and to nobody else.
   */
  private memberBook(bookId: string, actor: string): BookState {
    const state = this.books.get(bookId);
    if (state?.deleted) {
      const device = state.devices.get(actor);
      throw gone(state, !!device && !device.removedAt);
    }
    return this.requireBook(bookId);
  }

  private requireMember(state: BookState, actor: string): void {
    const device = state.devices.get(actor);
    if (!device) throw new SyncTransportError(401, 'unknown device');
    if (device.removedAt) throw new SyncTransportError(403, 'removed'); // §8.4, final review I2
  }

  private requireOwner(state: BookState, actor: string): void {
    this.requireMember(state, actor);
    if (!state.owners.has(actor)) throw new SyncTransportError(403, 'owner only');
  }

  /** `callerDeviceId` must be the id its own `device` derives to — the relay verifies a new device against the JWK in its own body (spec §9.1), never a claim it takes on faith. */
  async createBook(device: DevicePublic, callerDeviceId: string, options: { self?: boolean } = {}): Promise<{ bookId: string }> {
    const deviceId = await deviceIdOf(device).catch(() => null);
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
      ...(options.self ? { self: true } : {}),
      acks: new Map([[deviceId, 0]]),
      prunedThrough: 0,
      blobs: new Map(),
      deleted: false,
    });
    return { bookId };
  }

  /** Self books: this device has applied up to `seq`; entries every active device has applied are dropped. */
  async ack(bookId: string, seq: number, actorDeviceId: string): Promise<void> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireMember(state, actorDeviceId);
    if (!state.self) throw new SyncTransportError(400, 'only a self book is pruned');
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > state.seq) throw new SyncTransportError(400, 'ack past the log');
    state.acks.set(actorDeviceId, Math.max(state.acks.get(actorDeviceId) ?? 0, seq));
    const active = [...state.devices.entries()].filter(([, d]) => d.removedAt === undefined).map(([id]) => id);
    // A new device's copy taken at `startSeq` and not yet claimed holds everything after it (link my devices, §4.1).
    const waiting = [...state.invites.values()].filter((i) => i.startSeq !== undefined && i.claimedAt === undefined && Date.parse(i.expiresAt) > Date.now()).map((i) => i.startSeq!);
    const floor = Math.min(...active.map((id) => state.acks.get(id) ?? 0), ...waiting);
    for (let s2 = state.prunedThrough + 1; s2 <= floor; s2 += 1) state.log.delete(s2);
    state.prunedThrough = Math.max(state.prunedThrough, floor);
  }

  async putBlob(bookId: string, hash: string, data: string, expiresAt: string, actorDeviceId: string): Promise<void> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireMember(state, actorDeviceId);
    let bytes: Uint8Array;
    try {
      bytes = base64UrlToBytes(data);
    } catch {
      throw new SyncTransportError(400, 'expected base64url');
    }
    if (bytes.length > MAX_BLOB_BYTES) throw new SyncTransportError(413, 'blob over 700 KB');
    if ((await sha256Hex(bytes)) !== hash) throw new SyncTransportError(400, 'blob does not match its hash');
    const until = Date.parse(expiresAt);
    if (!Number.isFinite(until) || until > Date.now() + MAX_BLOB_TTL_MS) throw new SyncTransportError(400, 'a blob is kept a week at most');
    for (const [key, blob] of state.blobs) if (blob.expiresAt <= Date.now()) state.blobs.delete(key);
    const used = [...state.blobs.values()].reduce((total, blob) => total + blob.size, 0);
    if (used + bytes.length > MAX_BOOK_BLOB_BYTES) throw new SyncTransportError(413, 'this book holds too much already');
    state.blobs.set(hash, { data, expiresAt: until, size: bytes.length });
  }

  async getBlob(bookId: string, hash: string, actorDeviceId: string): Promise<string> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireMember(state, actorDeviceId);
    const blob = state.blobs.get(hash);
    if (!blob || blob.expiresAt <= Date.now()) throw new SyncTransportError(404, 'no such blob');
    return blob.data;
  }

  async deleteBlob(bookId: string, hash: string, actorDeviceId: string): Promise<void> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireMember(state, actorDeviceId);
    state.blobs.delete(hash);
  }

  async append(bookId: string, entry: LogEntry, actorDeviceId: string): Promise<{ seq: number }> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireMember(state, actorDeviceId);
    // A device only ever authors its own entries — never on another device's behalf (finding: bound identity).
    if (entry.deviceId !== actorDeviceId) throw new SyncTransportError(403, 'a device can only append its own entries');

    const dedupeKey = `${entry.deviceId}:${entry.hlc}`;
    const already = state.seen.get(dedupeKey);
    // A duplicate (deviceId, hlc) answers with the original seq — success, not an error (spec §3, §9.1 "Replay").
    // 409 on append is reserved for a rotation whose epoch is not current + 1.
    if (already !== undefined) return { seq: already };

    if (byteSize(entry) > MAX_ENTRY_BYTES) throw new SyncTransportError(413, 'entry over 128 KB');
    // A removal of another device needs an owner, as removeDevice does (spec §8.4, task 5 fix round 1).
    if (entry.kind === 'removal' && entry.target !== actorDeviceId && !state.owners.has(actorDeviceId)) {
      throw new SyncTransportError(403, 'only an owner removes another device');
    }
    if (entry.kind === 'rotation' && entry.epoch !== state.epoch + 1) {
      throw new SyncTransportError(409, 'a rotation must raise the epoch by exactly one');
    }
    // A change sealed under an epoch the book has rotated past (final review, I1): a device that was offline across a
    // removal would hand the removed device its backlog. It pulls the rotation and seals again.
    if (entry.kind === 'change' && entry.epoch < state.epoch) throw new SyncTransportError(409, 'stale epoch');

    const seq = state.seq + 1;
    state.seq = seq;
    state.log.set(seq, entry);
    state.seen.set(dedupeKey, seq);
    if (entry.kind === 'rotation') state.epoch = entry.epoch;
    return { seq };
  }

  async pull(bookId: string, since: number, actorDeviceId: string): Promise<{ entries: SequencedEntry[]; latest: number }> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireMember(state, actorDeviceId);
    // A self book's start is gone once every device has read it: a device that needs it is given a copy instead.
    if (since < state.prunedThrough) throw new SyncTransportError(410, 'pruned');

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
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireOwner(state, actorDeviceId);
    state.invites.set(invite.inviteId, { ...invite });
  }

  async previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    const found = this.findInvite(inviteId);
    if (!found) throw new SyncTransportError(404, 'no such invite');
    const { state, invite } = found;
    if (state.deleted) throw gone(state, false);
    return { preview: invite.preview, expiresAt: invite.expiresAt, claimed: invite.claimedAt !== undefined };
  }

  /** `callerDeviceId` must be the id its own `device` derives to, exactly as `createBook` requires. */
  async claimInvite(inviteId: string, device: DevicePublic, callerDeviceId: string): Promise<ClaimResult> {
    const deviceId = await deviceIdOf(device).catch(() => null);
    if (deviceId !== callerDeviceId) throw new SyncTransportError(403, 'a device can only claim as itself');

    const found = this.findInvite(inviteId);
    if (!found) throw new SyncTransportError(404, 'no such invite');
    const { bookId, state, invite } = found;
    if (state.deleted) throw gone(state, false);
    if (invite.claimedAt !== undefined) throw new SyncTransportError(409, 'invite already claimed');
    if (Date.parse(invite.expiresAt) <= Date.now()) throw new SyncTransportError(410, 'invite expired');
    if (!(await inviteSignedByAnOwner(invite, state.owners, (owner) => state.devices.get(owner)))) throw new SyncTransportError(403, 'bad owner signature');

    if (state.self && invite.startSeq !== undefined && invite.startSeq < state.prunedThrough) throw new SyncTransportError(410, 'pruned');
    const activeDevices = [...state.devices.values()].filter((d) => d.removedAt === undefined).length;
    if (activeDevices >= MAX_ACTIVE_DEVICES) throw new SyncTransportError(429, 'this book already has five devices');

    const now = new Date().toISOString();
    state.devices.set(deviceId, { signJwk: device.signJwk, agreeJwk: device.agreeJwk, addedAt: now });
    invite.claimedAt = now;
    // A self book: each of the owner's devices is an owner, and starts reading the log where it joined.
    if (state.self) {
      const from = invite.startSeq ?? state.seq;
      state.owners.add(deviceId);
      state.acks.set(deviceId, from);
      return { bookId, epoch: state.epoch, keys: invite.keys, sameMember: invite.sameMember, memberId: invite.memberId ?? deviceId, seq: from };
    }

    return { bookId, epoch: state.epoch, keys: invite.keys, sameMember: invite.sameMember, memberId: invite.memberId ?? deviceId };
  }

  async removeDevice(bookId: string, targetDeviceId: string, actorDeviceId: string): Promise<void> {
    const state = this.memberBook(bookId, actorDeviceId);
    // By an owner, for any device; by any device, for itself (spec §8.4).
    if (actorDeviceId === targetDeviceId) this.requireMember(state, actorDeviceId);
    else this.requireOwner(state, actorDeviceId);

    const device = state.devices.get(targetDeviceId);
    if (!device) throw new SyncTransportError(404, 'no such device');
    device.removedAt = new Date().toISOString();
    state.owners.delete(targetDeviceId);
  }

  async setOwners(bookId: string, deviceIds: string[], actorDeviceId: string): Promise<void> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireOwner(state, actorDeviceId);
    state.owners = new Set(deviceIds);
  }

  async deleteBook(bookId: string, actorDeviceId: string): Promise<void> {
    const state = this.memberBook(bookId, actorDeviceId);
    this.requireOwner(state, actorDeviceId);
    state.deleted = true;
    state.deletedBy = actorDeviceId;
  }

  private findInvite(inviteId: string): { bookId: string; state: BookState; invite: StoredInvite } | undefined {
    for (const [bookId, state] of this.books.entries()) {
      const invite = state.invites.get(inviteId);
      if (invite) return { bookId, state, invite };
    }
    return undefined;
  }
}

interface SignedRequest {
  deviceId: string;
  timestamp: number;
  bytes: Uint8Array;
  signature: string;
}

/** A `SyncTransport` bound to one device identity, so every call it makes is authorised as that device — never skippable. */
class BoundTransport implements SelfTransport {
  constructor(
    private readonly relay: MemoryTransport,
    private readonly deviceId: string,
    private readonly signer?: RequestSigner,
  ) {}

  /** Signs the request the way `RelayTransport` does, and has the relay check it the way the Worker does. */
  private async signed(method: string, path: string, body: unknown, bookId: string | null, bodyKey: JsonWebKey | null = null): Promise<void> {
    if (!this.signer) return;
    const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
    const timestamp = Date.now();
    const signingBytes = await requestSigningBytes(method, path, String(timestamp), bytes);
    const signature = bytesToBase64Url(await this.signer.sign(signingBytes));
    await this.relay.verifyRequest({ deviceId: this.deviceId, timestamp, bytes: signingBytes, signature }, bookId, bodyKey);
  }

  async createBook(device: DevicePublic): Promise<{ bookId: string }> {
    await this.signed('POST', '/books', device, null, device.signJwk);
    return this.relay.createBook(device, this.deviceId);
  }

  async append(bookId: string, entry: LogEntry): Promise<{ seq: number }> {
    await this.signed('POST', `/books/${bookId}/entries`, entry, bookId);
    return this.relay.append(bookId, entry, this.deviceId);
  }

  async pull(bookId: string, since: number): Promise<{ entries: SequencedEntry[]; latest: number }> {
    await this.signed('GET', `/books/${bookId}/entries?since=${since}`, undefined, bookId);
    return this.relay.pull(bookId, since, this.deviceId);
  }

  async putInvite(bookId: string, invite: InviteRecord): Promise<void> {
    await this.signed('POST', `/books/${bookId}/invites`, invite, bookId);
    return this.relay.putInvite(bookId, invite, this.deviceId);
  }

  previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    return this.relay.previewInvite(inviteId); // unauthenticated (§9.1)
  }

  async claimInvite(inviteId: string, device: DevicePublic): Promise<ClaimResult> {
    await this.signed('POST', `/invites/${inviteId}/claim`, device, null, device.signJwk);
    return this.relay.claimInvite(inviteId, device, this.deviceId);
  }

  async removeDevice(bookId: string, deviceId: string): Promise<void> {
    await this.signed('DELETE', `/books/${bookId}/devices/${deviceId}`, undefined, bookId);
    return this.relay.removeDevice(bookId, deviceId, this.deviceId);
  }

  async setOwners(bookId: string, deviceIds: string[]): Promise<void> {
    await this.signed('PUT', `/books/${bookId}/owners`, { deviceIds }, bookId);
    return this.relay.setOwners(bookId, deviceIds, this.deviceId);
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.signed('DELETE', `/books/${bookId}`, undefined, bookId);
    return this.relay.deleteBook(bookId, this.deviceId);
  }

  /* ---------------------------------------------------------------- link my devices */

  async createSelfBook(device: DevicePublic): Promise<{ bookId: string }> {
    await this.signed('POST', '/self-books', device, null, device.signJwk);
    return this.relay.createBook(device, this.deviceId, { self: true });
  }

  async ack(bookId: string, seq: number): Promise<void> {
    await this.signed('POST', `/books/${bookId}/ack`, { seq }, bookId);
    return this.relay.ack(bookId, seq, this.deviceId);
  }

  async putBlob(bookId: string, hash: string, data: string, expiresAt: string): Promise<void> {
    await this.signed('PUT', `/books/${bookId}/blobs/${hash}`, { data, expiresAt }, bookId);
    return this.relay.putBlob(bookId, hash, data, expiresAt, this.deviceId);
  }

  async getBlob(bookId: string, hash: string): Promise<string> {
    await this.signed('GET', `/books/${bookId}/blobs/${hash}`, undefined, bookId);
    return this.relay.getBlob(bookId, hash, this.deviceId);
  }

  async deleteBlob(bookId: string, hash: string): Promise<void> {
    await this.signed('DELETE', `/books/${bookId}/blobs/${hash}`, undefined, bookId);
    return this.relay.deleteBlob(bookId, hash, this.deviceId);
  }

  async startLink(device: DevicePublic): Promise<LinkView> {
    await this.signed('POST', '/links', device, null, device.signJwk);
    if ((await deviceIdOf(device).catch(() => null)) !== this.deviceId) throw new SyncTransportError(403, 'a device can only register itself');
    return linked(() => this.relay.links.start(this.deviceId, device));
  }

  async claimLink(code: string, device: DevicePublic, commit: string): Promise<LinkView> {
    await this.signed('POST', '/links/claim', { code, device, commit }, null, device.signJwk);
    if ((await deviceIdOf(device).catch(() => null)) !== this.deviceId) throw new SyncTransportError(403, 'a device can only claim as itself');
    return linked(() => this.relay.links.claim(this.deviceId, code, device, commit));
  }

  /** A party's call on a session: signed, and checked against the key the session holds for it. */
  private async party<T>(method: string, path: string, body: unknown, sessionId: string, work: () => Promise<T>): Promise<T> {
    const key = await linked(() => this.relay.links.partyKey(this.deviceId, sessionId));
    await this.signed(method, path, body, null, key);
    return linked(work);
  }

  readLink(sessionId: string): Promise<LinkView> {
    return this.party('GET', `/links/${sessionId}`, undefined, sessionId, () => this.relay.links.read(this.deviceId, sessionId));
  }

  revealLink(sessionId: string, nonce: string, joinerName?: SealedFor): Promise<LinkView> {
    const body = { nonce, ...(joinerName ? { joinerName } : {}) };
    return this.party('POST', `/links/${sessionId}/reveal`, body, sessionId, () => this.relay.links.reveal(this.deviceId, sessionId, nonce, joinerName));
  }

  allowLink(sessionId: string, welcome: SealedFor & { payload?: Sealed }): Promise<void> {
    return this.party('POST', `/links/${sessionId}/allow`, welcome, sessionId, () => this.relay.links.allow(this.deviceId, sessionId, welcome));
  }

  declineLink(sessionId: string): Promise<void> {
    return this.party('POST', `/links/${sessionId}/decline`, undefined, sessionId, () => this.relay.links.decline(this.deviceId, sessionId));
  }
}
