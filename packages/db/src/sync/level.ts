import { sql } from 'drizzle-orm';
import type { Db } from '../database';

/*
 * The sync capability level (sync gaps fix round 1, #1). Every build so far says it is app version 0.5.0, so a version
 * cannot tell a build that reads `bill.linked` from one that would take the link for a Pay payment (counted in the bill
 * month, Unlink refused, Undo voiding the real purchase on both phones). Each device says its level as a fourth release
 * segment of the `app_version` it writes on its own `book_devices` row: `0.5.0.1`. An older build writes `0.5.0` and
 * reads a peer's `0.5.0.1` as it always read versions, segment by segment (`meetsVersion`, `meetsMinVersion`), so every
 * minimum it checks is still met. A row with no fourth segment, or no version at all, is level 0.
 */

/** This build's level. 1: a purchase's `bill` may carry `linked: true`, and apply writes it as a link only. */
export const SYNC_LEVEL = 1;

/** The level a bill link needs from every device in the book before it is sent. */
export const BILL_LINK_LEVEL = 1;

/** `version` with this build's level as its fourth segment; a version that already has one keeps it. */
export function withSyncLevel(version: string, level: number = SYNC_LEVEL): string {
  const parts = version.split('.');
  if (level <= 0 || parts.length !== 3) return version;
  return `${version}.${level}`;
}

/** The level an `app_version` says: its fourth segment, else 0. */
export function syncLevelOf(version: string | null): number {
  if (version === null) return 0;
  const n = Number(version.split('.')[3]);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * Whether every device still in the book (not removed) is at `level` or above. A book with no device rows here (a test
 * of capture alone, with no engine) has nobody to misread anything: it is.
 */
export async function bookAtLevelTx(tx: Db, bookId: string, level: number): Promise<boolean> {
  const rows = await tx.values<[string | null]>(sql`SELECT app_version FROM book_devices WHERE book_id = ${bookId} AND removed_at IS NULL`).catch(() => [] as [string | null][]);
  return rows.every(([version]) => syncLevelOf(version) >= level);
}
