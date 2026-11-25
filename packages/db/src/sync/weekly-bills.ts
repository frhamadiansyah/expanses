import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { localDeviceId } from './capture';
import { meetsVersion, WEEKLY_BILLS_MIN_APP_VERSION } from './events/version';

/**
 * The other phones in a shared workspace on a build before `WEEKLY_BILLS_MIN_APP_VERSION`, by name: they cannot read a
 * bill that repeats every few weeks yet (see the constant). Empty for a workspace that is not shared, or before
 * sharing. A phone that has never said its version counts as one of them.
 */
export async function phonesBehindWeeklyBills(db: Db, bookId: string): Promise<string[]> {
  const tables = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'book_devices'`);
  if (tables.length === 0) return [];
  const self = await localDeviceId(db).catch(() => null);
  const rows = await db.values<[string, string, string | null]>(sql`
    SELECT d.device_id, d.name, d.app_version FROM book_devices d
    JOIN shared_books s ON s.book_id = d.book_id AND s.state = 'active'
    WHERE d.book_id = ${bookId} AND d.removed_at IS NULL ORDER BY d.name, d.device_id`);
  return rows.filter(([id, , version]) => id !== self && !meetsVersion(version, WEEKLY_BILLS_MIN_APP_VERSION)).map(([, name]) => name || 'another phone');
}
