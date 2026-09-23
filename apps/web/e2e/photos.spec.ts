import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { zipStore, unzipStore } from '@expanses/core';
import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import BetterSqlite3 from 'better-sqlite3';
import { addTransaction } from './add-transaction';

/*
 * The photographs, in the storage they actually live in.
 *
 * Everything else about photos is unit-tested against an in-memory stand-in for a directory handle. Three
 * things cannot be:
 *
 * - that `Layout.tsx` really runs the sweep at app start, against the real database (the store's own tests
 *   re-type that effect by hand, and a copy of a caller cannot regress when the caller does);
 * - that `store.ts`'s `as unknown as PhotoDirectory` over a real `FileSystemDirectoryHandle` works at all;
 * - that the backup zip — written by `BackupPage`, read back by `BackupPage` — round-trips, and that the
 *   restore refuses an entry no row on this device names.
 *
 * So these run in a real Chromium against real OPFS, and every assertion at the end reads the directory
 * itself rather than anything the app says about it.
 */

/** The directory `store.ts` keeps pictures in, a sibling of the database's `.expanses/` and never inside it. */
const PHOTO_DIRECTORY = 'expanses-photos';

/** What is in `expanses-photos/` right now, by name, read from the page rather than from the store. */
function photoFiles(page: Page): Promise<string[]> {
  return page.evaluate(async (directory) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(directory).catch(() => null);
    if (!dir) return [];
    const found: string[] = [];
    for await (const entry of dir.values()) found.push(entry.name);
    return found.sort();
  }, PHOTO_DIRECTORY);
}

/** The bytes of one picture on the device, as text, or null when it is not there. */
function photoText(page: Page, name: string): Promise<string | null> {
  return page.evaluate(
    async ([directory, fileName]) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(directory).catch(() => null);
      const handle = dir ? await dir.getFileHandle(fileName).catch(() => null) : null;
      return handle ? await (await handle.getFile()).text() : null;
    },
    [PHOTO_DIRECTORY, name] as const,
  );
}

/** Puts a file in the photo directory behind the app's back — an abandoned form's leftovers, in one line. */
function plantPhoto(page: Page, name: string, text: string): Promise<void> {
  return page.evaluate(
    async ([directory, fileName, content]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(directory, { create: true });
      const writable = await (await dir.getFileHandle(fileName, { create: true })).createWritable();
      await writable.write(new TextEncoder().encode(content));
      await writable.close();
    },
    [PHOTO_DIRECTORY, name, text] as const,
  );
}

/** One posted transaction, so there is something for a photo row to hang off. */
async function aTransaction(page: Page) {
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Visa', category: 'Groceries', amount: '500000' });
  await expect(page.getByText('Superindo')).toBeVisible();
}

/** The app's own backup, downloaded the way a user downloads it. */
async function downloadBackup(page: Page, target: string): Promise<string> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = await downloaded;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync((await backup.path())!));
  return target;
}

/**
 * The same backup with one `transaction_photos` row added, naming a file.
 *
 * Nothing in the app writes such a row yet — the form that takes a picture is a later task — so the row is
 * put in from outside, exactly as the migration describes it. That is enough: everything under test here
 * reads the row, and a row written by SQLite is the same row either way.
 */
function withAPhotoRow(source: string, target: string, fileName: string): string {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
  const db = new BetterSqlite3(target);
  try {
    const tx = db.prepare('SELECT id, workspace_id AS ws FROM transactions LIMIT 1').get() as { id: string; ws: string };
    db.prepare(
      "INSERT INTO transaction_photos (id, workspace_id, transaction_id, file_name, mime, byte_size, sort_order, created_at) VALUES (?, ?, ?, ?, 'image/jpeg', 9, 0, '2026-09-18T00:00:00.000Z')",
    ).run('photo-row-1', tx.ws, tx.id, fileName);
  } finally {
    db.close();
  }
  return target;
}

/** A restore, through both presses and the reload it ends in. */
async function restore(page: Page, file: string) {
  await page.goto('/backup');
  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await page.locator('input[accept*="sqlite3"]').setInputFiles(file);
  await safety;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
}

/**
 * The sweep, as the app actually runs it: no store handed in, no effect re-typed by hand, a real directory.
 *
 * The two mutations this exists to catch both leave the whole unit suite green: `sweepOrphanPhotos(kept ?? [])`
 * in `Layout.tsx` — the exact hazard the task is named for, put back — and turning the app-start sweep off.
 */
test('a picture no transaction names is gone the next time the app starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Transactions' }).first()).toBeVisible();

  await plantPhoto(page, 'abandoned-by-a-half-filled-form.jpg', 'a receipt nobody kept');
  expect(await photoFiles(page)).toEqual(['abandoned-by-a-half-filled-form.jpg']);

  await page.reload();
  await expect(page.getByRole('link', { name: 'Transactions' }).first()).toBeVisible();
  await expect.poll(() => photoFiles(page), { timeout: 15_000 }).toEqual([]);
});

/**
 * The zip: out of this device's storage and back into it, through the two buttons on `/backup`.
 *
 * The restore half is the load-bearing one. A zip cannot decide what this device's transactions point at, so
 * an entry no row names is counted and skipped rather than written — dropping that check is how an archive
 * gets to put bytes wherever it likes, and nothing anywhere used to notice it gone.
 */
test('photos download as a zip and come back from one, and an entry no row names is refused', async ({ page }, testInfo) => {
  test.slow();
  await aTransaction(page);

  // Nothing to download yet, so there is no button offering to: a zip of nothing is not a backup of anything.
  await page.goto('/backup');
  await expect(page.getByRole('button', { name: /^Download photos/ })).toHaveCount(0);

  const plain = await downloadBackup(page, join(testInfo.outputDir, 'no-photos.sqlite3'));
  await restore(page, withAPhotoRow(plain, join(testInfo.outputDir, 'with-photo.sqlite3'), 'named-by-a-row.jpg'));
  await expect(page.getByRole('button', { name: 'Download photos (1)' })).toBeVisible();

  // In: one entry a row names, one it does not. Only the first may reach the device.
  const zip = join(testInfo.outputDir, 'photos.zip');
  writeFileSync(
    zip,
    zipStore([
      { name: 'named-by-a-row.jpg', bytes: new TextEncoder().encode('a receipt') },
      { name: 'named-by-nothing.jpg', bytes: new TextEncoder().encode('bytes from somewhere else') },
    ]),
  );
  await page.locator('input[accept*="zip"]').setInputFiles(zip);
  await expect(page.getByText('1 photo restored · 0 already here · 1 not named by any transaction on this device')).toBeVisible();
  expect(await photoFiles(page)).toEqual(['named-by-a-row.jpg']);
  expect(await photoText(page, 'named-by-a-row.jpg')).toBe('a receipt');

  // A second pass over the same zip replaces nothing: what is on the device stays exactly as it is.
  await page.locator('input[accept*="zip"]').setInputFiles(zip);
  await expect(page.getByText('0 photos restored · 1 already here · 1 not named by any transaction on this device')).toBeVisible();

  /*
   * And the one screen that shows a photograph: the receipt's strip, with the bytes read back out of OPFS
   * and handed to the page as an object URL. This is the only place the `<img>` is exercised at all — the
   * store's own tests stop at the blob — and it is reached the way a desktop reaches it, through the ⓘ.
   */
  await page.goto('/transactions');
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveAttribute('src', /^blob:/);
  // The bytes behind that URL are this device's own, read back out of OPFS rather than fetched from anywhere.
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a receipt');
  await page.goto('/backup');

  // Out: the bytes on the device, in a zip any ordinary tool opens.
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download photos (1)' }).click();
  const out = await downloaded;
  expect(out.suggestedFilename()).toMatch(/^expanses-photos-\d{4}-\d{2}-\d{2}\.zip$/);
  const entries = unzipStore(readFileSync((await out.path())!));
  expect(entries.map((entry) => entry.name)).toEqual(['named-by-a-row.jpg']);
  expect(new TextDecoder().decode(entries[0]!.bytes)).toBe('a receipt');
});

/**
 * The data-loss path, end to end: a backup that simply predates a photograph.
 *
 * `BackupPage` reloads the page the moment a restore lands, and the app-start sweep then runs against the
 * restored database. To a database older than a picture, that picture is an orphan — so the sweep used to
 * delete it, and restoring the newer backup afterwards brought the row back and nothing else. The photograph
 * has no second copy anywhere: not in the sqlite file, not on a server, nowhere.
 */
test('restoring a backup older than a photograph does not destroy the photograph', async ({ page }, testInfo) => {
  test.slow();
  await aTransaction(page);

  // The older backup — real, valid, and simply taken before the picture was attached.
  const older = await downloadBackup(page, join(testInfo.outputDir, 'older.sqlite3'));
  const newer = withAPhotoRow(older, join(testInfo.outputDir, 'newer.sqlite3'), 'attached-to-superindo.jpg');

  // Today's state: the row names the file and the file is on the device.
  await restore(page, newer);
  writeFileSync(join(testInfo.outputDir, 'in.zip'), zipStore([{ name: 'attached-to-superindo.jpg', bytes: new TextEncoder().encode('a receipt') }]));
  await page.locator('input[accept*="zip"]').setInputFiles(join(testInfo.outputDir, 'in.zip'));
  await expect(page.getByText('1 photo restored · 0 already here')).toBeVisible();
  expect(await photoFiles(page)).toEqual(['attached-to-superindo.jpg']);

  // The restore that goes wrong, and the reload and sweep that follow it.
  await restore(page, older);
  await expect.poll(() => photoFiles(page), { timeout: 15_000 }).toEqual(['attached-to-superindo.jpg']);

  // And the launch after that, and the one after that. A hold that lasted one start would only move the loss
  // along by a launch, and a user working out what went wrong takes longer than that.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Transactions' }).first()).toBeVisible();
  await expect.poll(() => photoFiles(page), { timeout: 15_000 }).toEqual(['attached-to-superindo.jpg']);
  expect(await photoText(page, 'attached-to-superindo.jpg')).toBe('a receipt');

  // Putting the newer backup back brings the row back — and the photograph it names is still here for it.
  await restore(page, newer);
  await expect(page.getByRole('button', { name: 'Download photos (1)' })).toBeVisible();
  await expect.poll(() => photoFiles(page), { timeout: 15_000 }).toEqual(['attached-to-superindo.jpg']);
});
