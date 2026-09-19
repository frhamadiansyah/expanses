import { readFileSync, writeFileSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import { expect, type Page } from '@playwright/test';

// Not a spec: shared by `backup-reminders.spec.ts` (chromium) and `phone-backup-reminders.spec.ts`
// (phone), because ageing a real database is fiddly enough that both projects must do it identically.

/**
 * A copy of `source` at `target` whose last backup was `days` local calendar days ago.
 *
 * `last_backup_at` lives in the database, so the honest way to age it is to age the file: export once,
 * write the row in the exported copy, and restore that copy through the app's own Restore. Noon local is
 * used deliberately — the reminder counts local calendar days, and noon is the one time of day a clock
 * change cannot move to another date.
 */
export function agedBackup(source: string, target: string, days: number): string {
  writeFileSync(target, readFileSync(source));
  const when = new Date();
  when.setHours(12, 0, 0, 0);
  when.setDate(when.getDate() - days);
  const db = new BetterSqlite3(target);
  db.prepare("INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(when.toISOString());
  db.close();
  return target;
}

/**
 * Downloads a backup from /backup, ages it by `days`, and restores it — leaving the app open on a device
 * whose data has not been backed up in that long. The two-step restore is the app's own: the safety copy
 * downloads first, and the replacement needs a second, deliberate press.
 */
export async function restoreAgedByDays(page: Page, target: string, days: number): Promise<void> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const aged = agedBackup((await (await downloaded).path())!, target, days);

  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles(aged);
  await safety;
  // The restore reloads the page; wait for the new document before asking it anything.
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
}

/** The banner, found by what it says rather than by where it sits. */
export function overdueBanner(page: Page, days: number) {
  return page.getByRole('status').filter({ hasText: `No backup in ${days} days.` });
}

/** Where a "Not now" is remembered. Declared in `apps/web/src/features/backup/BackupBanner.tsx`. */
export const SNOOZE_KEY = 'expanses.backup-reminder.snoozed';

/** Winds a "Not now" back so the week it holds for has passed, as it will for the user a week later. */
export async function expireSnooze(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('nothing was put off, so nothing can expire');
    localStorage.setItem(key, JSON.stringify({ ...(JSON.parse(raw) as object), until: new Date(Date.now() - 86_400_000).toISOString() }));
  }, SNOOZE_KEY);
}
