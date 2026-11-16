import { monthStartOf } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Database, Db, Tx } from '../database';
import { captureConfigOf, localDeviceId, type SharedBook, writeChangeSetsTx } from './capture';
import { meetsVersion } from './events/version';
import type { Op } from './types';

/*
 * "Month starts on" in a shared workspace (0118): the book's `monthStartDay`, one value on every phone in it, so both
 * count the same months. A phone on an older build has no column for it: it applies the book's other fields, drops this
 * one and keeps its clock, and goes on counting calendar months — the setting only regroups, so nothing it holds is
 * wrong, only grouped the old way. Once it updates, migration 0118 drops that clock, and the other phones send the value
 * again (repair R6, sync/repairs.ts) the first time they see it at this version or later.
 */

/** The first app version that reads a workspace's "Month starts on". */
export const MONTH_START_MIN_APP_VERSION = '0.5.4';

/**
 * The other phones in a shared workspace on a build before `MONTH_START_MIN_APP_VERSION`, by name: they count calendar
 * months until they update. Empty for a workspace that is not shared, or before sharing. A phone that has never said
 * its version counts as one of them.
 */
export async function phonesBehindMonthStart(database: Database, bookId: string): Promise<string[]> {
  const tables = await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'book_devices'`);
  if (tables.length === 0) return [];
  const self = await localDeviceId(database.db).catch(() => null);
  const rows = await database.db.values<[string, string, string | null]>(sql`
    SELECT d.device_id, d.name, d.app_version FROM book_devices d
    JOIN shared_books s ON s.book_id = d.book_id AND s.state = 'active'
    WHERE d.book_id = ${bookId} AND d.removed_at IS NULL ORDER BY d.name, d.device_id`);
  return rows.filter(([id, , version]) => id !== self && !meetsVersion(version, MONTH_START_MIN_APP_VERSION)).map(([, name]) => name || 'another phone');
}

/**
 * R6: the book's `monthStartDay` sent again at the clock this phone holds it at — never a newer one, so a later change
 * on another phone still wins. Nothing goes for the 1st: it is what an updated phone holds already (the column's
 * default), and the clock every shared workspace's first copy carries for it. Returns how many ops (0 or 1).
 */
export async function resendMonthStartTx(tx: Tx, database: Database, book: SharedBook): Promise<number> {
  const [clock] = await tx.values<[string]>(sql`
    SELECT hlc FROM sync_field_clocks WHERE book_id = ${book.bookId} AND entity = 'book' AND id = ${book.bookId} AND field = 'monthStartDay'`);
  if (!clock) return 0;
  const [row] = await tx.values<[number]>(sql`SELECT month_start_day FROM books WHERE id = ${book.bookId}`);
  if (!row || monthStartOf(Number(row[0])) === 1) return 0;
  const op: Op = { entity: 'book', id: book.bookId, op: 'upsert', fields: { monthStartDay: Number(row[0]) }, changed: [], clocks: { monthStartDay: clock[0] } };
  await writeChangeSetsTx(tx, captureConfigOf(database), book, [op]);
  return 1;
}

/** Whether this database has the column (0118). */
export async function monthStartColumnTx(tx: Db): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM pragma_table_info('books') WHERE name = 'month_start_day'`)).length > 0;
}
