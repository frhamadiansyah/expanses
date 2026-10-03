import { unzipStore, zipStore } from '@expanses/core';

/**
 * What an iCloud copy is on the inside: a stored zip of the database, a short summary and (when asked) the photos,
 * locked with AES-256-GCM under a key kept in iCloud Keychain.
 *
 *   "CICISBK1" · header length (u32, big-endian) · header JSON · 12-byte IV · ciphertext and tag
 *
 * The header says only which key locked the copy and when it was taken; it is bound to the ciphertext as additional
 * data, so changing it breaks the copy rather than misleading the reader. Everything else — figures, counts, photos —
 * is inside the lock. A downloaded backup file stays unencrypted, because its owner chose where it went; this copy
 * leaves the phone on its own every day, so it is locked.
 */

const MAGIC = new TextEncoder().encode('CICISBK1');
const IV_BYTES = 12;

export const DATABASE_ENTRY = 'data.sqlite3';
export const SUMMARY_ENTRY = 'summary.json';
export const PHOTO_PREFIX = 'photos/';

/** The figures the first-open screen shows before anything is replaced. */
export interface CopySummary {
  takenAt: string;
  model: string;
  accounts: number;
  transactions: number;
  photos: number;
}

export interface CopyContents {
  database: Uint8Array;
  summary: CopySummary;
  photos: { name: string; bytes: Uint8Array }[];
}

interface Header {
  v: 1;
  keyId: string;
  takenAt: string;
}

/** Thrown when a file is not a copy this build can read, as opposed to a copy whose key is missing. */
export class NotACopyError extends Error {}

const importKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw.slice(), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export async function seal(contents: CopyContents, key: { keyId: string; raw: Uint8Array }): Promise<Uint8Array> {
  const header: Header = { v: 1, keyId: key.keyId, takenAt: contents.summary.takenAt };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, headerBytes.length);
  const aad = concat([MAGIC, length, headerBytes]);
  const zip = zipStore([
    { name: SUMMARY_ENTRY, bytes: new TextEncoder().encode(JSON.stringify(contents.summary)) },
    { name: DATABASE_ENTRY, bytes: contents.database },
    ...contents.photos.map((photo) => ({ name: PHOTO_PREFIX + photo.name, bytes: photo.bytes })),
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad.slice() }, await importKey(key.raw), zip.slice()));
  return concat([aad, iv, sealed]);
}

function readHeader(bytes: Uint8Array): { header: Header; aad: Uint8Array; rest: Uint8Array } {
  if (bytes.length < MAGIC.length + 4 || MAGIC.some((byte, i) => bytes[i] !== byte)) throw new NotACopyError('That file is not a cicis iCloud backup.');
  const length = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.length, 4).getUint32(0);
  const end = MAGIC.length + 4 + length;
  if (end + IV_BYTES > bytes.length) throw new NotACopyError('That iCloud backup is cut short.');
  let header: Header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length + 4, end))) as Header;
  } catch {
    throw new NotACopyError('That iCloud backup is damaged.');
  }
  if (header?.v !== 1 || typeof header.keyId !== 'string') throw new NotACopyError('That iCloud backup was made by a newer version of cicis. Update the app, then try again.');
  return { header, aad: bytes.subarray(0, end), rest: bytes.subarray(end) };
}

/** Which key a copy needs, read without opening it. */
export const keyIdOf = (bytes: Uint8Array): string => readHeader(bytes).header.keyId;

export async function unseal(bytes: Uint8Array, raw: Uint8Array): Promise<CopyContents> {
  const { aad, rest } = readHeader(bytes);
  let zip: Uint8Array;
  try {
    zip = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rest.slice(0, IV_BYTES), additionalData: aad.slice() }, await importKey(raw), rest.slice(IV_BYTES)),
    );
  } catch {
    throw new NotACopyError('That iCloud backup could not be opened: it is damaged, or was locked with a different key.');
  }
  const entries = unzipStore(zip);
  const database = entries.find((entry) => entry.name === DATABASE_ENTRY)?.bytes;
  const summary = entries.find((entry) => entry.name === SUMMARY_ENTRY)?.bytes;
  if (!database || !summary) throw new NotACopyError('That iCloud backup has no data in it.');
  return {
    database,
    summary: JSON.parse(new TextDecoder().decode(summary)) as CopySummary,
    photos: entries
      .filter((entry) => entry.name.startsWith(PHOTO_PREFIX))
      .map((entry) => ({ name: entry.name.slice(PHOTO_PREFIX.length), bytes: entry.bytes }))
      // A photo is put back under its own name in the photo folder, never anywhere a path could reach.
      .filter((photo) => /^[A-Za-z0-9._-]+$/.test(photo.name) && !photo.name.startsWith('.')),
  };
}
