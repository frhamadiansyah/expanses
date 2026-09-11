import { type Database, schema } from '@expanses/db';

export const LAST_BACKUP_KEY = 'last_backup_at';
const SQLITE_MAGIC = 'SQLite format 3';

export async function getLastBackupAt(database: Database): Promise<string | null> {
  const rows = await database.db.select().from(schema.settings);
  return rows.find((r) => r.key === LAST_BACKUP_KEY)?.value ?? null;
}

export async function setLastBackupAt(database: Database, iso: string): Promise<void> {
  await database.db
    .insert(schema.settings)
    .values({ key: LAST_BACKUP_KEY, value: iso })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: iso } });
}

export type BackupUrgency = 'ok' | 'remind' | 'warn';

/** Remind after 7 days without a backup, warn after 14, warn immediately if data exists and was never backed up. */
export function backupUrgency(lastBackupAt: string | null, hasData: boolean, now: Date = new Date()): BackupUrgency {
  if (!hasData) return 'ok';
  if (!lastBackupAt) return 'warn';
  const days = (now.getTime() - new Date(lastBackupAt).getTime()) / 86_400_000;
  if (days >= 14) return 'warn';
  if (days >= 7) return 'remind';
  return 'ok';
}

export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/** SQLite files start with the 15 ASCII bytes "SQLite format 3" followed by a zero byte. */
export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  return new TextDecoder().decode(bytes.subarray(0, 15)) === SQLITE_MAGIC && bytes[15] === 0;
}
