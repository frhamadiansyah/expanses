import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { localDeviceId } from './capture';
import { BUDGET_REPEAT_MIN_APP_VERSION, meetsVersion, WEEKLY_BILLS_MIN_APP_VERSION } from './events/version';

/**
 * The other phones in a shared workspace on a build before `version`, by name. Empty for a workspace that is not
 * shared, or before sharing. A phone that has never said its version counts as one of them.
 */
async function phonesBehind(db: Db, bookId: string, version: string): Promise<string[]> {
  const tables = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'book_devices'`);
  if (tables.length === 0) return [];
  const self = await localDeviceId(db).catch(() => null);
  const rows = await db.values<[string, string, string | null]>(sql`
    SELECT d.device_id, d.name, d.app_version FROM book_devices d
    JOIN shared_books s ON s.book_id = d.book_id AND s.state = 'active'
    WHERE d.book_id = ${bookId} AND d.removed_at IS NULL ORDER BY d.name, d.device_id`);
  return rows.filter(([id, , have]) => id !== self && !meetsVersion(have, version)).map(([, name]) => name || 'another phone');
}

/** The other phones that cannot read a bill that repeats every few weeks yet (see `WEEKLY_BILLS_MIN_APP_VERSION`). */
export function phonesBehindWeeklyBills(db: Db, bookId: string): Promise<string[]> {
  return phonesBehind(db, bookId, WEEKLY_BILLS_MIN_APP_VERSION);
}

/** The other phones that cannot read a budget by days or weeks yet (see `BUDGET_REPEAT_MIN_APP_VERSION`). */
export function phonesBehindBudgetRepeat(db: Db, bookId: string): Promise<string[]> {
  return phonesBehind(db, bookId, BUDGET_REPEAT_MIN_APP_VERSION);
}
