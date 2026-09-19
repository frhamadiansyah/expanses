import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { addBank, EXPORT_BUTTON, replaceTheDatabase } from './recovery-fixture';

/*
 * An old app must never open, migrate, or adopt data a newer app wrote: it would write rows the newer
 * schema does not describe and drop the columns it has never heard of. Nothing here is stubbed — a real
 * database is taken out of the running app, given a version this build has never heard of, and handed
 * back to it through the two doors a user can actually push it through: a restore, and the file itself.
 */

/** The version nobody will ever ship: "impossibly far in the future", so this never turns into a race with migration 48. */
const FUTURE = 999;

/** The words the app says either way, from `recovery-copy.ts` and `newer-database.ts`. */
const REFUSAL = 'This data was made by a newer version of Expanses';

/** A backup that claims a version this build has never heard of — a TestFlight file, or a downgrade. */
function fromTheFuture(source: string, target: string): string {
  // The test's own output directory is only created when something is attached to it; this is first.
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
  const db = new BetterSqlite3(target);
  db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, 'from_the_future', '2027-01-01T00:00:00.000Z')").run(FUTURE);
  db.close();
  return target;
}

/** The highest version recorded in a SQLite file on disk, read without the app. */
function versionOf(file: string): number {
  const db = new BetterSqlite3(file, { readonly: true });
  try {
    return Number((db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as { v: number }).v);
  } finally {
    db.close();
  }
}

/** The app's own backup, downloaded the way a user downloads it, then aged forward. */
async function futureBackup(page: Page, target: string): Promise<string> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = await downloaded;
  return fromTheFuture((await backup.path())!, target);
}

test('a restore of data from a newer app is refused before it is adopted, and the device keeps its data', async ({ page }, testInfo) => {
  await addBank(page, 'Still here', '1000000');
  const future = await futureBackup(page, join(testInfo.outputDir, 'future.sqlite3'));

  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles(future);
  await safety;
  await page.getByRole('button', { name: /Replace my data with/ }).click();

  /*
   * Refused at the restore, before it is adopted. The wording is the restore's own — "nothing on this
   * device was changed" — and the user is still standing on the backup page rather than in recovery,
   * which is the difference that matters: adopting the file first and refusing to open it afterwards
   * would show the same headline from the other side of a reload, with the future data now live.
   */
  await expect(page.getByText(REFUSAL)).toBeVisible();
  await expect(page.getByText(`Nothing on this device was changed: that copy was written by update ${FUTURE}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  // Export is never taken away from someone whose only problem is an out-of-date app.
  await expect(page.getByRole('button', { name: 'Download backup' })).toBeEnabled();

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Still here' })).toBeVisible();
});

test('a database already at a newer version refuses to open, and offers export but never deletion', async ({ page }, testInfo) => {
  await addBank(page, 'Untouched', '1000000');

  // Put the future file on disk the only way a user can: page the bytes in through OPFS from recovery
  // mode, where nothing opens the VFS and the pool holds no handles. Same trick as the corruption test.
  const future = await futureBackup(page, join(testInfo.outputDir, 'future.sqlite3'));
  await replaceTheDatabase(page, readFileSync(future));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: REFUSAL, exact: true })).toBeVisible();
  await expect(page.getByText(/This copy of the app is older than the data on this device/)).toBeVisible();

  // Both versions are there for anyone who wants them, under Details, where every technical line lives.
  await page.getByRole('group').getByText('Details', { exact: true }).click();
  await expect(page.getByText(new RegExp(`Your data: update ${FUTURE} · This app: update \\d+`))).toBeVisible();

  // Nothing here offers to destroy data the app merely cannot read yet, and an older copy is not the fix.
  await expect(page.getByRole('button', { name: /Start fresh/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restore the last good copy/ })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: EXPORT_BUTTON, exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^expanses-recovery-\d{4}-\d{2}-\d{2}\.sqlite3$/);
  // The refusal never wrote: what comes out is still the newer file, ready for a device with a newer app.
  expect(versionOf((await file.path())!)).toBe(FUTURE);
});
