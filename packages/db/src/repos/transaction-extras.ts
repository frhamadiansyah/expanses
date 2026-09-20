import { uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { transactions } from '../schema';
import { transactionFlags, transactionPhotos } from '../schema-extras';

/** One picture kept for a transaction: the row is the index, the file in OPFS is the picture. */
export interface TransactionPhotoRow {
  id: string;
  transactionId: string;
  /** The file's name in OPFS under expanses-photos/, which is what `readPhotoBytes` and `photoUrl` take. */
  fileName: string;
  mime: string;
  byteSize: number;
  sortOrder: number;
  createdAt: string;
}

/**
 * Whether migration 0048 has run on this database. Every read and write of transaction_flags and
 * transaction_photos asks first, so a database stopped at an older version behaves exactly as it does today:
 * no channel, not excluded, no photos. A positive answer is remembered per handle; a negative one is not,
 * since migrate() may run later on the same handle.
 */
const extrasTables = new WeakMap<Db, boolean>();

export async function extrasTablesExist(db: Db): Promise<boolean> {
  if (extrasTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transaction_flags'`);
  const exists = rows.length > 0;
  if (exists) extrasTables.set(db, true);
  return exists;
}

/** The facts beside the money, named exactly as `PostTransactionInput` names them, so one fact never travels under two names. */
export interface ExtrasInput {
  channel?: 'online' | 'offline' | null;
  excludedFromReport?: boolean;
  /** Photo rows written before the transaction had an id. */
  photoIds?: string[];
}

/**
 * Writes what was chosen beside a posting, inside the posting's own database transaction. A flag row is written
 * only when something is actually set: a row of null and 0 says nothing a missing row does not, and an existing
 * row is taken away when both facts go back to nothing. Then the photo rows named by `photoIds` — written while
 * the form was still open and owned by nobody — are re-keyed onto this transaction.
 */
export async function writeExtrasTx(tx: Db, ws: WorkspaceContext, transactionId: string, input: ExtrasInput): Promise<void> {
  const channel = input.channel ?? null;
  const excluded = input.excludedFromReport ? 1 : 0;
  if (channel === null && excluded === 0) {
    await tx.delete(transactionFlags).where(and(eq(transactionFlags.transactionId, transactionId), eq(transactionFlags.workspaceId, ws.workspaceId)));
  } else {
    await tx
      .insert(transactionFlags)
      .values({ transactionId, workspaceId: ws.workspaceId, channel, excluded })
      .onConflictDoUpdate({ target: transactionFlags.transactionId, set: { workspaceId: ws.workspaceId, channel, excluded } });
  }
  if (input.photoIds && input.photoIds.length > 0) {
    await tx
      .update(transactionPhotos)
      .set({ transactionId })
      .where(and(eq(transactionPhotos.workspaceId, ws.workspaceId), inArray(transactionPhotos.id, input.photoIds)));
  }
}

/**
 * What a transaction says about itself, read inside a database transaction, so a correction can carry each fact
 * separately — one it does not mention is kept, one it mentions is obeyed. Null when there is no row.
 */
export async function extrasForTx(
  tx: Db,
  ws: WorkspaceContext,
  transactionId: string,
): Promise<{ channel: 'online' | 'offline' | null; excluded: boolean } | null> {
  const [row] = await tx
    .select({ channel: transactionFlags.channel, excluded: transactionFlags.excluded })
    .from(transactionFlags)
    .where(and(eq(transactionFlags.transactionId, transactionId), eq(transactionFlags.workspaceId, ws.workspaceId)));
  if (!row) return null;
  return { channel: row.channel ?? null, excluded: row.excluded === 1 };
}

/**
 * Re-keys the photo rows onto a replacement, the way `replaceTransaction` already moves card postings. Photos are
 * rows, not input fields: there is nothing to carry field by field, so this one really is a move.
 */
export async function movePhotosTx(tx: Db, ws: WorkspaceContext, fromId: string, toId: string): Promise<void> {
  await tx
    .update(transactionPhotos)
    .set({ transactionId: toId })
    .where(and(eq(transactionPhotos.workspaceId, ws.workspaceId), eq(transactionPhotos.transactionId, fromId)));
}

export interface TransactionExtras {
  channel: 'online' | 'offline' | null;
  excluded: boolean;
  photoCount: number;
}

/** One query per list, keyed by transaction, so a page of rows pays two small queries and not one per row. */
export async function extrasFor(db: Db, ws: WorkspaceContext, ids: readonly string[]): Promise<Map<string, TransactionExtras>> {
  const found = new Map<string, TransactionExtras>();
  if (ids.length === 0) return found;
  const at = (id: string): TransactionExtras => {
    const existing = found.get(id);
    if (existing) return existing;
    const fresh: TransactionExtras = { channel: null, excluded: false, photoCount: 0 };
    found.set(id, fresh);
    return fresh;
  };
  const flags = await db
    .select({ transactionId: transactionFlags.transactionId, channel: transactionFlags.channel, excluded: transactionFlags.excluded })
    .from(transactionFlags)
    .where(and(eq(transactionFlags.workspaceId, ws.workspaceId), inArray(transactionFlags.transactionId, [...ids])));
  for (const row of flags) {
    const entry = at(row.transactionId);
    entry.channel = row.channel ?? null;
    entry.excluded = row.excluded === 1;
  }
  const counts = await db
    .select({ transactionId: transactionPhotos.transactionId, count: sql<number>`count(*)` })
    .from(transactionPhotos)
    .where(and(eq(transactionPhotos.workspaceId, ws.workspaceId), inArray(transactionPhotos.transactionId, [...ids])))
    .groupBy(transactionPhotos.transactionId);
  for (const row of counts) at(row.transactionId).photoCount = Number(row.count);
  return found;
}

/**
 * The transactions a report must leave out — those the user marked excluded — for the readers that add money up.
 *
 * It takes the context on purpose: transaction_flags carries workspace_id, every other predicate in reports.ts and
 * flows.ts scopes on it, and an unscoped NOT IN lets one workspace's exclusion silently delete another
 * workspace's figure.
 */
export const notExcluded = (ws: WorkspaceContext): SQL =>
  sql`${transactions.id} NOT IN (SELECT transaction_id FROM transaction_flags WHERE excluded = 1 AND workspace_id = ${ws.workspaceId})`;

export interface AddPhotoInput {
  /** The transaction it belongs to, or '' for a picture a form wrote before the transaction had an id. */
  transactionId: string;
  fileName: string;
  mime: string;
  byteSize: number;
}

/**
 * Writes the index row for one picture and returns its id — a transaction_photos.id, never an OPFS file name.
 *
 * The one function here that **throws** rather than answering quietly when migration 0048 has not run, for the
 * same reason `savePhotoBytes` throws when OPFS is missing (`apps/web/src/photos/store.ts`): there is no honest
 * empty answer. A device sitting below `LATEST_VERSION` because an update is blocked is a real state
 * (`apps/web/src/db/open.ts`), and on such a device there is no `transaction_photos` table to write to. An id
 * handed back from a write that never happened is a phantom: a draft carries it into `photoIds`, `writeExtrasTx`
 * re-keys zero rows, and the user is shown a form that accepted a photograph attached to a transaction that has
 * none of it. Throwing lets the form say "photos are not available on this device", which is the truth.
 *
 * `listPhotos`, `deletePhoto` and `allPhotoRows` still answer empty, because empty is what they really mean:
 * a database with no table holds no photos, and there is nothing to delete.
 */
export async function addPhoto(database: Database, ws: WorkspaceContext, input: AddPhotoInput): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    if (!(await extrasTablesExist(tx))) {
      throw new Error('This device cannot keep photos yet: the database is at a version with no transaction_photos table.');
    }
    await tx.insert(transactionPhotos).values({
      id,
      workspaceId: ws.workspaceId,
      transactionId: input.transactionId,
      fileName: input.fileName,
      mime: input.mime,
      byteSize: input.byteSize,
      // The pictures keep the order they were picked in. The column's DEFAULT 0 is for rows written by anything
      // else; this repository never leans on it.
      sortOrder: sql`(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM transaction_photos WHERE workspace_id = ${ws.workspaceId} AND transaction_id = ${input.transactionId})`,
      createdAt: new Date().toISOString(),
    });
  });
  return id;
}

/** A transaction's pictures, in the order they were picked. `sort_order, id` is a total order, never a tie. */
export async function listPhotos(database: Database, ws: WorkspaceContext, transactionId: string): Promise<TransactionPhotoRow[]> {
  if (!(await extrasTablesExist(database.db))) return [];
  const rows = await database.db
    .select()
    .from(transactionPhotos)
    .where(and(eq(transactionPhotos.workspaceId, ws.workspaceId), eq(transactionPhotos.transactionId, transactionId)))
    .orderBy(asc(transactionPhotos.sortOrder), asc(transactionPhotos.id));
  return rows.map(toRow);
}

export async function deletePhoto(database: Database, ws: WorkspaceContext, photoId: string): Promise<void> {
  await database.transaction(async (tx) => {
    if (!(await extrasTablesExist(tx))) return;
    await tx.delete(transactionPhotos).where(and(eq(transactionPhotos.workspaceId, ws.workspaceId), eq(transactionPhotos.id, photoId)));
  });
}

/** This workspace's picture rows, for the backup's "Download photos (N)". */
export async function allPhotoRows(database: Database, ws: WorkspaceContext): Promise<TransactionPhotoRow[]> {
  if (!(await extrasTablesExist(database.db))) return [];
  const rows = await database.db
    .select()
    .from(transactionPhotos)
    .where(eq(transactionPhotos.workspaceId, ws.workspaceId))
    .orderBy(asc(transactionPhotos.transactionId), asc(transactionPhotos.sortOrder), asc(transactionPhotos.id));
  return rows.map(toRow);
}

/**
 * Every file name in the database, whatever workspace it belongs to, for the orphan sweep and nothing else —
 * or **null**, meaning this database cannot say.
 *
 * Null is the whole point of the signature, and it is not the same fact as `[]`.
 *
 * `[]` says "there are no photos"; null says "there is no table to ask". Both are true states of a real device,
 * and the sweep's only job is to delete the files no row names — so if the second were reported as the first,
 * the sweep would read it as "no file on this device is referenced" and delete every one of them. That is not
 * hypothetical: a device holding a blocked update opens at the version below it (see `db/open.ts`), which on
 * this branch is a version with no `transaction_photos` table, while the photo store writes files without ever
 * asking the database anything. The picture taken a minute ago would go, and a photo has no second copy — not
 * in the sqlite backup, not anywhere. So the difference is carried in the type, and the sweep refuses on null.
 *
 * It deliberately takes no WorkspaceContext. A workspace-scoped read would hand the sweep another workspace's
 * pictures as orphans and it would delete them. Rows for pictures a form wrote before its transaction had an id
 * are returned too, so a picture waiting on an unsaved form is never swept away while the form is open.
 */
export async function allPhotoFileNames(database: Database): Promise<string[] | null> {
  if (!(await extrasTablesExist(database.db))) return null;
  const rows = await database.db.select({ fileName: transactionPhotos.fileName }).from(transactionPhotos);
  return rows.map((row) => row.fileName);
}

function toRow(row: typeof transactionPhotos.$inferSelect): TransactionPhotoRow {
  return {
    id: row.id,
    transactionId: row.transactionId,
    fileName: row.fileName,
    mime: row.mime,
    byteSize: Number(row.byteSize),
    sortOrder: Number(row.sortOrder),
    createdAt: row.createdAt,
  };
}
