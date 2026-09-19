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

/** Writes the index row for one picture and returns its id — a transaction_photos.id, never an OPFS file name. */
export async function addPhoto(database: Database, ws: WorkspaceContext, input: AddPhotoInput): Promise<string> {
  const id = uuidv7();
  await database.transaction(async (tx) => {
    if (!(await extrasTablesExist(tx))) return;
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
 * Every file name in the database, whatever workspace it belongs to, for the orphan sweep and nothing else.
 *
 * It deliberately takes no WorkspaceContext. The sweep deletes the files no row names; a workspace-scoped read
 * would hand it another workspace's pictures as orphans and it would delete them — user data with no second copy.
 * Rows for pictures a form wrote before its transaction had an id are returned too, so a picture waiting on an
 * unsaved form is never swept away while the form is open.
 */
export async function allPhotoFileNames(database: Database): Promise<string[]> {
  if (!(await extrasTablesExist(database.db))) return [];
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
