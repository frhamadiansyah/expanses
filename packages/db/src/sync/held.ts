import { sql } from 'drizzle-orm';
import type { Database, Db } from '../database';
import type { BookContext } from './apply';
import { parseOpId, type RowEntity } from './shared-entities';

/*
 * Ids already here (sharing-resilience spec §4.1, §4.2). A joining phone holds a row under an id the log sends only when
 * it holds an earlier copy of the same data. Apply never stalls on one:
 *
 * - D-A2: a purchase whose transaction id is taken, its lineage not held here, is posted under a local id
 *   (`remapId`). Transaction ids are already local (every replace mints one that is never sent), so the shared state
 *   is the same on every device; the holder row is left as it is.
 * - D-A3: a lineage, or a row keyed by its own id, held by another book that exists here is a local skip
 *   (`HELD_ELSEWHERE: <holder book>`), never sent, never a stop; Place them now pulls again once the holder is gone.
 * - D-A4: a row in the scope of no book here (a dead leftover) is adopted into the joining book.
 */

/** The error prefix of a `sync_skipped` row set aside because another copy here holds it: the one local-row-dependent skip. */
export const HELD_PREFIX = 'HELD_ELSEWHERE';

/** A lineage or row the log sends that another book on this phone holds (D-A3): recorded as a skip, never a stop. */
export class HeldElsewhere extends Error {
  constructor(readonly holderBookId: string) {
    super(`${HELD_PREFIX}: ${holderBookId}`);
    this.name = 'HeldElsewhere';
  }
}

/** Where remapped transaction ids are named from. Fixed for ever: an id worked out under it may already be on a phone. */
const REMAP_NAMESPACE = 'f6c157a2-6158-434d-81d7-dd27c86d79f0';

/**
 * The local transaction id a purchase is posted under when its lineage id is taken here (D-A2): uuidv5 of
 * `remap:<bookId>:<lineageId>`, with `:<attempt>` appended from the second attempt on. Never sent.
 */
export function remapId(bookId: string, lineageId: string, attempt = 1): string {
  return uuidv5Sync(REMAP_NAMESPACE, `remap:${bookId}:${lineageId}${attempt > 1 ? `:${attempt}` : ''}`);
}

/** The id a new lineage's first transaction is posted under here: the lineage id while it is free, else the first free `remapId`. */
export async function freeTransactionIdTx(tx: Db, bookId: string, lineageId: string): Promise<string> {
  const taken = async (id: string) => (await tx.values(sql`SELECT 1 FROM transactions WHERE id = ${id}`)).length > 0;
  if (!(await taken(lineageId))) return lineageId;
  for (let attempt = 1; ; attempt += 1) {
    const id = remapId(bookId, lineageId, attempt);
    if (!(await taken(id))) return id;
  }
}

export type RowPlace = { place: 'here' } | { place: 'elsewhere'; bookId: string } | { place: 'dead' };

/**
 * The existing row's place: 'here' (in this book's scope), 'elsewhere' (in the scope of another book that exists here —
 * a `books` row, or a shared log's `shared_books` row: an event's or a net-worth group's), 'dead' (no book here reaches it).
 * Other books are tried in id order, so the holder named is always the same one.
 */
export async function rowPlaceTx(tx: Db, entity: RowEntity, id: string, bookId: string): Promise<RowPlace> {
  const key = parseOpId(entity, id);
  const match = sql.join(
    entity.keyColumns.map((column) => sql`t.${sql.raw(column)} = ${key[column]!}`),
    sql` AND `,
  );
  const inScope = async (book: string) => (await tx.values(sql`SELECT 1 FROM ${sql.raw(entity.table)} t WHERE ${match} AND ${entity.scope(book)} LIMIT 1`)).length > 0;
  if (await inScope(bookId)) return { place: 'here' };
  const others = await tx.values<[string]>(sql`
    SELECT id FROM books WHERE id <> ${bookId}
    UNION SELECT book_id FROM shared_books WHERE book_id <> ${bookId}
    ORDER BY 1`);
  for (const [other] of others) if (await inScope(other)) return { place: 'elsewhere', bookId: other };
  return { place: 'dead' };
}

/**
 * A dead leftover filed into the joining book (D-A4), before the log's fields are written over it as for any existing
 * row. A category gets the book's tag and the book's workspace; every other row's scope follows its parent (a budget or
 * bill its category, a stage its goal), so adopting a category adopts them.
 */
export async function adoptRowTx(tx: Db, ctx: BookContext, entity: RowEntity, id: string): Promise<void> {
  if (entity.entity !== 'category') return;
  await tx.run(sql`UPDATE accounts SET workspace_id = ${ctx.ws.workspaceId} WHERE id = ${id}`);
  await tx.run(sql`INSERT OR IGNORE INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${id}, ${ctx.ws.workspaceId}, ${ctx.bookId})`);
}

/** One row of a share set aside because another copy on this phone holds it (D-A3). */
export interface HeldRow {
  entity: string;
  id: string;
  holderBookId: string;
  /** The holder's name here, while it has a `books` row. */
  holderName: string | null;
  /** Whether the holder still exists here (a `books` or `shared_books` row): Place them now waits until none does. */
  holderExists: boolean;
}

/** The book's rows set aside as held by another copy here, once each (the latest skip of each), in entity and id order. */
export async function heldElsewhereOf(database: Database, bookId: string): Promise<HeldRow[]> {
  const rows = await database.db.values<[string, string, string]>(sql`
    SELECT s.entity, s.id, s.error FROM sync_skipped s
    WHERE s.book_id = ${bookId} AND s.error LIKE ${`${HELD_PREFIX}: %`}
      AND s.rowid = (SELECT max(x.rowid) FROM sync_skipped x WHERE x.book_id = s.book_id AND x.entity = s.entity AND x.id = s.id AND x.error LIKE ${`${HELD_PREFIX}: %`})
    ORDER BY s.entity, s.id`);
  const out: HeldRow[] = [];
  for (const [entity, id, error] of rows) {
    const holderBookId = error.slice(HELD_PREFIX.length + 2);
    const [book] = await database.db.values<[string]>(sql`SELECT name FROM books WHERE id = ${holderBookId}`);
    const shared = (await database.db.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${holderBookId}`)).length > 0;
    out.push({ entity, id, holderBookId, holderName: book?.[0] ?? null, holderExists: book !== undefined || shared });
  }
  return out;
}

/* ------------------------------------------------------- uuidv5, synchronously */

/*
 * `remapId` is worked out inside apply's loops and compared in tests, so it is synchronous: the same RFC 4122 version-5
 * uuid `uuidv5.ts` makes over WebCrypto (a test checks the two agree), over a plain SHA-1.
 */

function uuidv5Sync(namespace: string, name: string): string {
  const hex = namespace.replace(/-/g, '');
  const ns = Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns, 0);
  data.set(nameBytes, ns.length);
  const hash = sha1(data).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const out = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

/** SHA-1 (FIPS 180-4) of `data`. Used for naming only, never for security. */
export function sha1(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
  return out;
}
