import type { ChangeSet, LogEntry } from './types';

/*
 * Encrypting and signing a change-set into a `LogEntry`, and back (spec §6.6). Real crypto is AES-GCM under the
 * book's epoch key with ECDSA over the entry (task 5, §5). This step is the stub named at spec §14 step 1: "keys
 * are a stub". The interface is async and shaped so a real implementation drops in without changing any caller —
 * `hlc` and `deviceId` are not extra arguments because they already live on the change-set and the sealer itself.
 */

export type ChangeLogEntry = Extract<LogEntry, { kind: 'change' }>;

export interface Sealer {
  /** This sealer's own device id, stamped onto every entry it seals. */
  readonly deviceId: string;

  /** Encrypts and signs a change-set for `bookId` under `epoch`, producing a `change` log entry. */
  seal(bookId: string, epoch: number, changeSet: ChangeSet): Promise<ChangeLogEntry>;

  /** The inverse of `seal`: decrypts a `change` entry back into its change-set. Does not check the signature. */
  open(bookId: string, entry: ChangeLogEntry): Promise<ChangeSet>;

  /** Whether an entry's signature is valid. Never decrypts; callers check this before trusting `open`'s result. */
  verify(entry: LogEntry): Promise<boolean>;
}

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

function fromBase64Url(text: string): string {
  return Buffer.from(text, 'base64url').toString('utf8');
}

/**
 * The identity `Sealer`: no encryption, no real signature. `ct` is `base64url(JSON(changeSet))`; `iv` and `sig` are
 * placeholder strings, present only so every caller of `Sealer` can already shape its code around the real fields
 * task 5 will fill with AES-GCM ciphertext and an ECDSA signature.
 */
export class IdentitySealer implements Sealer {
  constructor(readonly deviceId: string) {}

  async seal(bookId: string, epoch: number, changeSet: ChangeSet): Promise<ChangeLogEntry> {
    void bookId; // Not needed until real encryption keys the ciphertext to (bookId, epoch, deviceId) as AAD.
    return {
      kind: 'change',
      deviceId: this.deviceId,
      epoch,
      hlc: changeSet.hlc,
      iv: 'stub-iv',
      ct: toBase64Url(JSON.stringify(changeSet)),
      sig: `stub-sig:${this.deviceId}`,
    };
  }

  async open(bookId: string, entry: ChangeLogEntry): Promise<ChangeSet> {
    void bookId;
    return JSON.parse(fromBase64Url(entry.ct)) as ChangeSet;
  }

  async verify(entry: LogEntry): Promise<boolean> {
    // Identity stub: an entry is "signed" by the placeholder convention `stub-sig:<deviceId>` (also read by
    // memory-transport.ts for an invite's owner signature). Replaced by real ECDSA verification in task 5.
    return entry.sig === `stub-sig:${entry.deviceId}`;
  }
}

/** The placeholder signing convention shared by `IdentitySealer` and `MemoryTransport`'s stub owner-signature check. */
export function stubSign(deviceId: string): string {
  return `stub-sig:${deviceId}`;
}
