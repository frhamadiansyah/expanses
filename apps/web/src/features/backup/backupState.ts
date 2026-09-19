import { type Database, schema } from '@expanses/db';
import type { SnapshotReason } from '../../db/open';

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

export type BackupUrgency = 'ok' | 'remind' | 'warn' | 'overdue';

/** Every level that has something to say. `ok` is the silence, and never reaches the words below. */
export type BackupReminder = Exclude<BackupUrgency, 'ok'>;

/**
 * Remind after 7 days without a backup, warn after 14, and call it overdue at 30 — or the moment there
 * is data here that has never been backed up at all, which is the worst case there is rather than a
 * middling one: nothing this user owns exists anywhere but in this browser.
 *
 * `now` is an argument and never an ambient clock, so the rule can be read and tested as a rule.
 */
export function backupUrgency(lastBackupAt: string | null, hasData: boolean, now: Date = new Date()): BackupUrgency {
  if (!hasData) return 'ok';
  if (!lastBackupAt) return 'overdue';
  const days = daysSince(lastBackupAt, now);
  if (days >= 30) return 'overdue';
  if (days >= 14) return 'warn';
  if (days >= 7) return 'remind';
  return 'ok';
}

/** Midnight at the start of `at`'s own local day, as a UTC instant — so a difference of days is exact. */
const localMidnight = (at: Date): number => Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());

/**
 * Whole days between `iso` and `now`, counted in the device's own calendar rather than in elapsed hours.
 *
 * A backup taken at half past eleven last night is a day old at ten past midnight, because that is what a
 * person means by "yesterday" — and because the alternative rolls the day at 07:00 for a user in Jakarta.
 * Comparing local midnights (through `Date.UTC`, which has no daylight saving of its own) keeps every
 * difference an exact multiple of a day across a clock change. A future date reads as 0, never as less.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.max(0, Math.round((localMidnight(now) - localMidnight(then)) / 86_400_000));
}

/**
 * What the reminder says. A pure function so the copy is tested as prose rather than asserted through
 * the DOM, and so both halves of the sentence move together when either is reworded.
 *
 * "Your only copy is on this device" is the harder sentence, kept for `overdue` where it is the plain
 * truth. Neither line mentions the safety copies the app takes for itself: those sit on this same
 * device, so they are not a backup, and saying so here would be the one comforting lie in the app.
 */
export function bannerWords(urgency: BackupReminder, days: number | null): string {
  const how = days === null ? 'You have not backed up yet.' : `No backup in ${days} days.`;
  return `${how} ${urgency === 'overdue' ? 'Your only copy is on this device.' : 'Your data exists only on this device.'}`;
}

/** A "Not now": the level that was put off, and the date it is put off until. */
export interface BackupSnooze {
  until: string;
  urgency: BackupReminder;
}

/** How long a "Not now" holds. Long enough not to nag, short enough to still be a reminder. */
export const SNOOZE_DAYS = 7;

/** The date a "Not now" pressed at `now` holds the reminder back until. */
export function snoozeUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + SNOOZE_DAYS * 86_400_000).toISOString();
}

const RANK: Record<BackupReminder, number> = { remind: 1, warn: 2, overdue: 3 };

/**
 * Whether the reminder should be on screen at all.
 *
 * Two rules, and they are the whole of "never nag": a level the user has put off stays put off for a
 * week, and the app never asks twice about the same thing in between. But a reminder that has grown
 * worse is a different sentence about a different risk, so it speaks once more the day it does — which
 * is also why the level that was dismissed is remembered alongside the date.
 */
export function reminderDue(urgency: BackupUrgency, snooze: BackupSnooze | null, now: Date = new Date()): boolean {
  if (urgency === 'ok') return false;
  if (!snooze) return true;
  if (RANK[urgency] > (RANK[snooze.urgency] ?? 0)) return true;
  const until = new Date(snooze.until).getTime();
  // A stored date this build cannot read is no reason to keep quiet about an only copy.
  return Number.isNaN(until) || until <= now.getTime();
}

/** Why one of the app's own safety copies was taken, in the words the Backup screen lists it under. */
export function copyReasonWords(reason: SnapshotReason): string {
  switch (reason) {
    case 'before-migration':
      return 'Taken before an update';
    case 'before-restore':
      return 'Taken before a restore';
    case 'before-start-fresh':
      return 'Taken before starting fresh';
    case 'daily':
      return 'The day’s copy';
  }
}

/** SQLite files start with the 15 ASCII bytes "SQLite format 3" followed by a zero byte. */
export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  return new TextDecoder().decode(bytes.subarray(0, 15)) === SQLITE_MAGIC && bytes[15] === 0;
}
