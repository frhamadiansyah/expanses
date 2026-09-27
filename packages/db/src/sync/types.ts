/*
 * The wire shapes of household sharing (spec §3, §6.2, §6.6). One truth per device's local SQLite; the relay is an
 * append-only log per book and a device allow-list. `MemoryTransport` (memory-transport.ts) is the in-process
 * reference; `RelayTransport` (task 6) talks the same shapes over HTTP to the Cloudflare relay.
 */

/** A device's two public keys (spec §5.1): ECDSA P-256 for signing, ECDH P-256 for agreement. */
export interface DevicePublic {
  signJwk: JsonWebKey;
  agreeJwk: JsonWebKey;
}

/** AES-GCM output, base64url throughout (spec §3). */
export interface Sealed {
  iv: string;
  ct: string;
}

/** One op inside a change-set (spec §6.2). A `purchase` is never deleted; it is voided by an upsert of `{ void: true }`. */
export type Op =
  | {
      entity: string;
      id: string;
      op: 'upsert';
      fields: Record<string, unknown>;
      /**
       * The fields this upsert changed, when `fields` carries more: a row that can be made again after a delete
       * travels whole so it can always be inserted, but only the fields it names win and take a clock (§7.2, task 4
       * fix round 1). Absent: every field in `fields` changed.
       */
      changed?: string[];
      /**
       * For a revivable row: the hlc each carried field that is not in `changed` last changed at on the sending
       * device (a field with no clock there is left out). Named fields are at the change-set's hlc. A receiver merges
       * every carried field by its own hlc (§7.2, task 4 fix round 2).
       */
      clocks?: Record<string, string>;
    }
  | { entity: string; id: string; op: 'delete' };

/** A batch of ops, cut to size by split.ts and sealed into a `LogEntry` of kind `change` (spec §6.2). */
export interface ChangeSet {
  v: 1;
  hlc: string;
  member: string;
  ops: Op[];
  /** On a device's introduction only: the invite terms an owner signed (§8.2, task 5 fix round 1). */
  invite?: InviteTerms;
}

/**
 * What an owner's invite allows, signed by the owner device (spec §8.1–8.2, task 5 fix round 1): travels sealed inside
 * the preview to the joiner, and inside the joiner's introduction to every device, which checks it before pinning.
 */
export interface InviteTerms {
  inviteId: string;
  sameMember: boolean;
  memberId?: string;
  sig: string; // base64url ECDSA P-256 over `termsSigningBytes`
}

/** An epoch key sealed for one device by ECDH + HKDF (spec §5.3), carried inside a `rotation` entry. */
export interface SealedFor {
  deviceId: string;
  epoch: number;
  ephJwk: JsonWebKey;
  iv: string;
  ct: string;
}

/**
 * A row of the relay's append-only log (spec §6.6). `change` carries an encrypted, signed change-set; `removal`
 * drops a device; `rotation` re-keys the book after a removal. No entry carries a name — device and member names
 * travel only inside `change` entries' sealed payload.
 */
export type LogEntry =
  | { kind: 'change'; deviceId: string; epoch: number; hlc: string; iv: string; ct: string; sig: string }
  | {
      kind: 'removal';
      deviceId: string;
      epoch: number;
      hlc: string;
      target: string;
      /**
       * Leave (§8.4, task 9a): a device removing itself because its member leaves. Every other device of the same
       * member, applying it, removes itself too. Counts only when `target` is the author. Signed like every field.
       */
      leave?: true;
      sig: string;
    }
  | { kind: 'rotation'; deviceId: string; epoch: number; hlc: string; sealed: SealedFor[]; sig: string };

/** A `LogEntry` as the relay hands it back: its position in the log, and the author's pinned signing key. */
export type SequencedEntry = LogEntry & { seq: number; signJwk: JsonWebKey };

/**
 * What `putInvite` stores and `previewInvite`/`claimInvite` read back (spec §8.1 step 5, §9.2, §9.3). `keys` and
 * `preview` are each sealed with the invite key derived from the code's random half (`S`); `sig` is the owner
 * device's signature over the rest of the record, verified by the relay against its pinned key (spec §5.4).
 */
export interface InviteRecord {
  inviteId: string;
  keys: Sealed;
  preview: Sealed;
  expiresAt: string;
  sameMember: boolean;
  memberId?: string;
  sig: string;
}

/** `claimInvite`'s success shape (spec §8.2 step 5, §9.2). */
export interface ClaimResult {
  bookId: string;
  epoch: number;
  keys: Sealed;
  sameMember: boolean;
  memberId: string;
}

/**
 * A transport failure that carries the HTTP status the relay would answer with (spec §9.2), so `RelayTransport`
 * (task 6) can map a real response's status onto the same error type `MemoryTransport` already throws, and callers
 * write one branch for both.
 */
export class SyncTransportError extends Error {
  readonly status: number;
  /** On a `410` for a book its owner deleted (§8.6, task 9a): the device that deleted it, as the relay recorded it. */
  readonly deletedBy?: string;

  constructor(status: number, message: string, detail: { deletedBy?: string } = {}) {
    super(message);
    this.name = 'SyncTransportError';
    this.status = status;
    if (detail.deletedBy !== undefined) this.deletedBy = detail.deletedBy;
  }
}

/**
 * The relay's answer to a device the book has removed (§8.4, final review I2): `403 { error: 'removed' }`, given only
 * once the request's signature verifies under the device's stored key. A clock five minutes off, or a device the book
 * never had, is `401` instead; so a client can tell "I was removed" from "try again later".
 */
export function removedFromBook(error: unknown): boolean {
  return error instanceof SyncTransportError && error.status === 403 && error.message === 'removed';
}

/**
 * Each device's local SQLite is the truth; the relay is an append-only log per book and a device allow-list
 * (spec §3). `append` treats a duplicate `(deviceId, hlc)` as success (idempotent replay), never as an error.
 */
export interface SyncTransport {
  createBook(device: DevicePublic): Promise<{ bookId: string }>;
  append(bookId: string, entry: LogEntry): Promise<{ seq: number }>;
  pull(bookId: string, since: number): Promise<{ entries: SequencedEntry[]; latest: number }>;
  putInvite(bookId: string, invite: InviteRecord): Promise<void>;
  previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }>;
  claimInvite(inviteId: string, device: DevicePublic): Promise<ClaimResult>;
  removeDevice(bookId: string, deviceId: string): Promise<void>;
  setOwners(bookId: string, deviceIds: string[]): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
}
