/*
 * The share record (spec §6.1, D-B1): one per shared book, kept beside the device keys and outside the database, so a
 * lost or replaced database can find its shares again. It holds what the database held about the share — the relay
 * book, this device's member, the epoch keys exactly as `book_epoch_keys.key_sealed` stores them (sealed for this
 * device's own agreement key, never an opened key) and the cursor — and nothing the database does not.
 *
 * Where it lives is the app's concern: `WebShareRecordStore` (IndexedDB `cicis-keys`, store `shares`) and
 * `NativeShareRecordStore` (keychain item `cicis-keys.shares`, this device only) in `apps/web`, and
 * `MemoryShareRecordStore` here for tests and anything else that runs in Node.
 */

export interface ShareRecord {
  v: 1;
  bookId: string;
  relayBookId: string;
  memberId: string;
  /** This device's id when written; a record for another id is ignored (§6.1). */
  deviceId: string;
  /** As the view had it when written; informational. */
  role: 'owner' | 'member';
  bookName: string;
  /** `books.kind` here. */
  bookKind: string;
  workspaceId: string;
  baseCurrency: string;
  /** `book_epoch_keys.key_sealed`, byte for byte. */
  epochKeys: { epoch: number; sealed: string }[];
  /** This device's cursor when last written. */
  appliedSeq: number;
  updatedAt: string;
}

export interface ShareRecordStore {
  list(): Promise<ShareRecord[]>;
  get(bookId: string): Promise<ShareRecord | null>;
  /** Writes the record of `record.bookId`, replacing any there. */
  put(record: ShareRecord): Promise<void>;
  /** Drops the record of the book; a book with none is a no-op. */
  remove(bookId: string): Promise<void>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * A stored record read back, or null for anything that is not a v1 record with every field typed. The result is a
 * fresh object of the known fields only; the sealed keys are kept as the strings they were.
 */
export function parseShareRecord(raw: unknown): ShareRecord | null {
  if (!isObject(raw) || raw.v !== 1) return null;
  const { bookId, relayBookId, memberId, deviceId, role, bookName, bookKind, workspaceId, baseCurrency, epochKeys, appliedSeq, updatedAt } = raw;
  if (!isId(bookId) || !isId(relayBookId) || !isId(memberId) || !isId(deviceId)) return null;
  if (role !== 'owner' && role !== 'member') return null;
  if (typeof bookName !== 'string' || typeof bookKind !== 'string' || typeof workspaceId !== 'string') return null;
  if (typeof baseCurrency !== 'string' || typeof updatedAt !== 'string' || !isCount(appliedSeq)) return null;
  if (!Array.isArray(epochKeys)) return null;
  const keys: { epoch: number; sealed: string }[] = [];
  for (const key of epochKeys) {
    if (!isObject(key) || !isCount(key.epoch) || typeof key.sealed !== 'string') return null;
    keys.push({ epoch: key.epoch, sealed: key.sealed });
  }
  return { v: 1, bookId, relayBookId, memberId, deviceId, role, bookName, bookKind, workspaceId, baseCurrency, epochKeys: keys, appliedSeq, updatedAt };
}

/** The record as a store keeps it: checked, its known fields only. Throws a TypeError for one that would not read back. */
export function storableShareRecord(record: ShareRecord): ShareRecord {
  const stored = parseShareRecord(record);
  if (!stored) throw new TypeError(`Share record of ${String((record as { bookId?: unknown }).bookId)} is not a v1 record`);
  return stored;
}

/**
 * Records in memory, by book id. Every read and write is a copy, so no caller holds the store's own objects; only a
 * record `parseShareRecord` reads is stored, with its known fields only.
 */
export class MemoryShareRecordStore implements ShareRecordStore {
  private readonly records = new Map<string, ShareRecord>();

  async list(): Promise<ShareRecord[]> {
    return [...this.records.values()].map((r) => structuredClone(r));
  }

  async get(bookId: string): Promise<ShareRecord | null> {
    const found = this.records.get(bookId);
    return found ? structuredClone(found) : null;
  }

  /** Refuses (TypeError) a record that would not read back, as the app's stores do: a write never stores one. */
  async put(record: ShareRecord): Promise<void> {
    const stored = storableShareRecord(record);
    this.records.set(stored.bookId, stored);
  }

  async remove(bookId: string): Promise<void> {
    this.records.delete(bookId);
  }
}
