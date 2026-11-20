import type { DevicePublic, Sealed, SealedFor, SyncTransport } from '../sync/types';
import type { LinkView } from './link-hub';

/*
 * Link my devices (spec §3.5, §5): what the self channel needs of a relay beyond household sharing's book and log —
 * the owner's own relay book (pruned once every device has read it), blobs for the copy a new device starts from, and
 * the link meeting place (`link-hub.ts`). `MemoryTransport` and `RelayTransport` both implement it, with the same
 * statuses.
 */

/** A blob's bytes travel as base64url; at most this many bytes each, so a request stays under the relay's 1 MB. */
export const MAX_BLOB_BYTES = 700 * 1024;
/** All of one book's blobs together. */
export const MAX_BOOK_BLOB_BYTES = 256 * 1024 * 1024;
/** How long a blob may be kept at most. */
export const MAX_BLOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SelfTransport extends SyncTransport {
  /** A relay book for the owner's own devices: every device of it is an owner, and its log is pruned (`ack`). */
  createSelfBook(device: DevicePublic): Promise<{ bookId: string }>;
  /** This device has applied the log up to `seq`; entries every device has applied are dropped (self books only). */
  ack(bookId: string, seq: number): Promise<void>;
  /** Stores a blob under the sha-256 (hex) of its bytes, until `expiresAt`. */
  putBlob(bookId: string, hash: string, data: string, expiresAt: string): Promise<void>;
  getBlob(bookId: string, hash: string): Promise<string>;
  deleteBlob(bookId: string, hash: string): Promise<void>;

  startLink(device: DevicePublic): Promise<LinkView>;
  claimLink(code: string, device: DevicePublic, commit: string): Promise<LinkView>;
  readLink(sessionId: string): Promise<LinkView>;
  revealLink(sessionId: string, nonce: string, joinerName?: SealedFor): Promise<LinkView>;
  allowLink(sessionId: string, welcome: SealedFor & { payload?: Sealed }): Promise<void>;
  declineLink(sessionId: string): Promise<void>;
}

export function isSelfTransport(transport: SyncTransport): transport is SelfTransport {
  return typeof (transport as Partial<SelfTransport>).createSelfBook === 'function';
}
