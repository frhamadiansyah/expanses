import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import {
  addBank,
  corruptTheDatabase,
  CORRUPT_HEADLINE,
  EXPORT_BUTTON,
  forgetSafetyCopies,
  replaceTheDatabase,
  safetyCopies,
  waitForSafetyCopy,
} from './recovery-fixture';

// The feature is not real until a genuinely corrupt OPFS database produces the screen, so nothing here
// is stubbed: a bank account is entered, the slot file behind it is overwritten, and the app is reopened.

test.describe.configure({ mode: 'parallel' });

test('a corrupt database opens the recovery screen, and the data can still be exported', async ({ page }) => {
  await addBank(page, 'Rescue me', '1000000');
  await corruptTheDatabase(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();
  await expect(page.getByText(/still on this device and most of it is almost certainly fine/i)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: EXPORT_BUTTON, exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^expanses-recovery-\d{4}-\d{2}-\d{2}\.sqlite3$/);
});

/**
 * The whole point of the layer, end to end: a real database, a real copy of it in OPFS, really corrupted,
 * and the data actually back on screen afterwards.
 *
 * The copies are forgotten and the app reopened after the bank is added on purpose. The day's copy is
 * taken once per calendar day, and this browser's was taken the moment the app first opened — before
 * "Rescue me" existed. Restoring that would prove only that an empty database can be put back.
 */
test('restore the last good copy brings the data back after corruption', async ({ page }) => {
  await addBank(page, 'Rescue me', '1000000');
  await forgetSafetyCopies(page);
  await page.goto('/');
  await waitForSafetyCopy(page);

  await corruptTheDatabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();
  const restore = page.getByRole('button', { name: /Restore the last good copy/ });
  // The copy is named by when it was taken and how big it is, so nobody presses this blind.
  await expect(restore).toContainText(/From .+ · [\d.]+ (KB|MB)/);
  await Promise.all([page.waitForEvent('load'), restore.click()]);

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Rescue me' })).toBeVisible();
});

/**
 * Restoring twice must not hand the corruption back.
 *
 * The first restore keeps a `before-restore` copy of what it replaces — which, on this journey, is a copy
 * of the corrupt file. It is the newest copy on the device from that moment on, and it is an undo, not a
 * candidate: "the last good copy" has to skip it and reach past to the day's copy, or a user who presses
 * the biggest button twice ends up exactly where they started.
 */
test('the last good copy skips the copy taken of the corruption', async ({ page }) => {
  await addBank(page, 'Rescue me', '1000000');
  await forgetSafetyCopies(page);
  await page.goto('/');
  await waitForSafetyCopy(page);

  await corruptTheDatabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Restore the last good copy/ }).click()]);
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Rescue me' })).toBeVisible();
  // Two copies now: the day's, and the undo taken of the corrupt file a moment ago.
  await expect.poll(async () => (await safetyCopies(page)).length).toBeGreaterThanOrEqual(2);

  // The same thing goes wrong again, and the screen is asked the same question a second time.
  await corruptTheDatabase(page);
  await page.goto('/');
  const restore = page.getByRole('button', { name: /Restore the last good copy/ });
  await expect(restore).toBeVisible();
  await expect(restore).toContainText(/From .+ · [\d.]+ (KB|MB)/);

  // The undo is not hidden — it is where an undo belongs, among the copies the user can go through.
  await page.getByText('Choose a different copy').click();
  await expect(page.getByText('Taken before a restore')).toBeVisible();

  // And the big button hands back the data, not the copy of the corruption taken since.
  await Promise.all([page.waitForEvent('load'), restore.click()]);
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Rescue me' })).toBeVisible();
});

/**
 * A second tab is told what it is, and offered only what can work there.
 *
 * The first tab holds every one of the database's files open. Export reads them and still works; a restore
 * or a wipe would both fail on them, so neither is on screen — nobody presses a button here that cannot
 * succeed, on the one screen where a dead button would be read as "my data is gone".
 */
test('a second tab says so plainly, and offers nothing that cannot work', async ({ page, context }) => {
  await addBank(page, 'Open in the first tab', '1000000');

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Expanses is already open in another tab', exact: true })).toBeVisible();
  await expect(second.getByText('Close the other Expanses tab or window, then try again here.')).toBeVisible();

  await expect(second.getByRole('button', { name: /Restore the last good copy/ })).toHaveCount(0);
  await expect(second.getByRole('button', { name: /Start fresh/ })).toHaveCount(0);
  await expect(second.getByRole('link', { name: /recovery tools/i })).toHaveCount(0);

  // Export reads the bytes off OPFS without the engine, so it works even while the other tab holds them.
  const download = second.waitForEvent('download');
  await second.getByRole('button', { name: EXPORT_BUTTON, exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^expanses-recovery-\d{4}-\d{2}-\d{2}\.sqlite3$/);

  // And the first tab was never disturbed by any of it.
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Open in the first tab' })).toBeVisible();
  await second.close();
});

/**
 * Start fresh when the engine itself will not do the wipe.
 *
 * `wipeEverything` asks the worker first, because the worker is what holds the slot files open; if it will
 * not start, the directories are removed from the page instead. That fallback is the whole reason a user
 * whose database cannot be opened can still start again — so here the engine is prevented from taking the
 * wipe at all, and the device still has to end up empty.
 */
test('start fresh still empties the device when the engine will not do the wipe', async ({ page }) => {
  await addBank(page, 'About to go', '1000000');
  const copy = await waitForSafetyCopy(page);

  await page.addInitScript(() => {
    const Real = window.Worker;
    class RefusesToWipe extends Real {
      postMessage(message: unknown, transfer?: unknown) {
        if ((message as { op?: string } | null)?.op === 'wipe') {
          // Exactly what a worker that cannot install the SAH pool does: it fails instead of answering.
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'The database engine did not start.' })), 0);
          return;
        }
        super.postMessage(message, transfer as Transferable[]);
      }
    }
    window.Worker = RefusesToWipe as unknown as typeof Worker;
  });

  await page.goto('/?recover');
  await expect(page.getByRole('heading', { name: 'Recovery tools', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start fresh on this device', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Start fresh' });
  await sheet.getByLabel('I already have a backup').check();
  await Promise.all([page.waitForEvent('load'), sheet.getByRole('button', { name: 'Delete everything on this device', exact: true }).click()]);

  // Everything went, the copies included, even though the engine never took part. (The empty database this
  // opened on may have had a copy of its own taken since; that one is not it.)
  expect(await safetyCopies(page)).not.toContain(copy);
  await page.goto('/accounts');
  await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'About to go' })).toHaveCount(0);
});

/**
 * Start fresh from `/` — the path a frightened user actually takes. It is only possible because a failed
 * open now terminates the worker: while that worker lived, it held the pool's sync access handles and
 * every attempt to remove the files failed with "modifications are not allowed".
 */
test('start fresh needs two presses, says what it deletes, and empties the device from a failed open', async ({ page }) => {
  await addBank(page, 'About to go', '1000000');
  await waitForSafetyCopy(page);
  await corruptTheDatabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start fresh on this device', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Start fresh' });
  await expect(sheet.getByText('It cannot be undone.')).toBeVisible();
  // The size and the copies are read off the device itself, so the list is what is really about to go.
  await expect(sheet.getByRole('listitem').filter({ hasText: /Your data on this device — [\d.]+ MB/ })).toBeVisible();
  await expect(sheet.getByRole('listitem').filter({ hasText: /A copy from .+ — [\d.]+ (KB|MB)/ })).toBeVisible();

  const confirm = sheet.getByRole('button', { name: 'Delete everything on this device', exact: true });
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel('I already have a backup').check();
  await expect(confirm).toBeEnabled();
  await Promise.all([page.waitForEvent('load'), confirm.click()]);

  await page.goto('/accounts');
  await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'About to go' })).toHaveCount(0);
});

test('start fresh from the recovery tools empties a device whose file will not open', async ({ page }) => {
  await addBank(page, 'About to go', '1000000');
  const copy = await waitForSafetyCopy(page);
  await corruptTheDatabase(page);
  // Recovery mode never opens the database, so nothing holds the slot files and the wipe can take them.
  await expect(page.getByRole('heading', { name: 'Recovery tools', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start fresh on this device', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Start fresh' });
  const confirm = sheet.getByRole('button', { name: 'Delete everything on this device', exact: true });
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel('I already have a backup').check();
  await Promise.all([page.waitForEvent('load'), confirm.click()]);

  await page.goto('/accounts');
  // The app opens rather than falling back into recovery: a device that has never run Expanses.
  await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'About to go' })).toHaveCount(0);
  // A clean slate is clean: the copy of the old data went with the pool, not just the database the VFS
  // owns. (A fresh copy of the new, empty database may already have been taken — that one is not it.)
  expect(await safetyCopies(page)).not.toContain(copy);
});

/*
 * What the user sees while a long update runs.
 *
 * Nothing here is stubbed either. A real database is taken out of the running app, wound back to the very
 * first version this project ever shipped, and handed back through OPFS — so the app really does run the
 * whole chain of migrations on the way in, with a real safety copy taken first and the real check after.
 *
 * Every number is read off the migrations directory rather than written down here: the step count and the
 * version reached move with the project, and a test that hard-codes today's highest version is a test that
 * fails on the day someone adds one.
 */
const MIGRATION_FILES = readdirSync(fileURLToPath(new URL('../../../packages/db/migrations/', import.meta.url)))
  .filter((name) => name.endsWith('.sql'))
  .sort();
const FIRST = MIGRATION_FILES[0]!;
/** The one migration the wound-back file keeps, so the app sees data it must update rather than a new device. */
const FIRST_MIGRATION = { version: Number(FIRST.slice(0, 4)), name: FIRST.slice(5, -4), file: FIRST };
const LATEST_VERSION = Number(MIGRATION_FILES.at(-1)!.slice(0, 4));
/** Everything above the first one: exactly what the app has to run, and the total the screen counts to. */
const STEPS = MIGRATION_FILES.length - 1;

/** The app's own backup, downloaded the way a user downloads it. */
async function downloadBackup(page: Page, target: string): Promise<string> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  // The test's own output directory is only created when something is attached to it; this is first.
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync((await (await downloaded).path())!));
  return target;
}

/**
 * The same file, wound back to the first version.
 *
 * Deleting rows from `schema_migrations` would not do: the migrations would run again over the schema they
 * already built, and the ones that create a table rather than an index would fail on the first statement.
 * The schema itself has to go back — so every table is dropped and the first migration is applied over the
 * top, leaving a file at version 1 that the app must carry all the way forward.
 *
 * No VACUUM, deliberately: the freed pages stay in the file, so it is still the size the slot it goes back
 * into expects.
 */
function woundBackToTheFirstVersion(source: string, target: string): string {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
  const db = new BetterSqlite3(target);
  try {
    db.pragma('foreign_keys = OFF');
    const objects = db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string; type: string }[];
    for (const object of objects) db.exec(`DROP ${object.type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS "${object.name}"`);
    db.exec(readFileSync(fileURLToPath(new URL(`../../../packages/db/migrations/${FIRST_MIGRATION.file}`, import.meta.url)), 'utf8'));
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      FIRST_MIGRATION.version,
      FIRST_MIGRATION.name,
      '2024-01-01T00:00:00.000Z',
    );
  } finally {
    db.close();
  }
  return target;
}

/**
 * Records every distinct thing the app puts on screen, from before its own script runs.
 *
 * The opening screen is by design transient — it is there for as long as the work takes and not a moment
 * longer — so polling for it is a race the test would sometimes lose. This watches instead, and the
 * assertions read the list afterwards. Reinstalled on every navigation, and reset with the page.
 */
async function watchTheOpening(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __openingSeen: string[] }).__openingSeen = seen;
    const record = () => {
      const text = document.getElementById('root')?.textContent ?? '';
      if (text && text !== seen[seen.length - 1]) seen.push(text);
    };
    // `document` itself, not `documentElement`: this runs before the page's own scripts, early enough
    // that the <html> element may not be there yet to observe.
    new MutationObserver(record).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

const whatWasOnScreen = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __openingSeen?: string[] }).__openingSeen ?? []);

test('a long update says which step it is on, then offers a backup of the updated data', async ({ page }, testInfo) => {
  await watchTheOpening(page);
  await addBank(page, 'Replaced wholesale', '1000000');
  const backup = await downloadBackup(page, join(testInfo.outputDir, 'now.sqlite3'));
  await replaceTheDatabase(page, readFileSync(woundBackToTheFirstVersion(backup, join(testInfo.outputDir, 'old.sqlite3'))));

  await page.goto('/');
  // The card above the page is the proof the update finished, and it names the version it reached.
  await expect(page.getByText(`Your data was updated to version ${LATEST_VERSION}`)).toBeVisible({ timeout: 45_000 });

  const seen = await whatWasOnScreen(page);
  const updating = seen.filter((text) => text.includes('Updating your data…'));
  const context = `screens seen: ${seen.join(' | ')}`;
  expect(updating.length, context).toBeGreaterThan(0);
  // The total is the work there really is, and the step moves: a bar that never moved would pass neither.
  expect(updating.some((text) => text.includes(`of ${STEPS} ·`)), context).toBe(true);
  expect(new Set(updating).size, context).toBeGreaterThan(1);
  // The reassurance is only said because a copy really was taken: this file had data, so there was one.
  expect(updating.some((text) => text.includes('Do not close the app. Your data was copied before we started.')), context).toBe(true);

  // A backup is offered because the one the user holds is now older than their data.
  await expect(page.getByRole('button', { name: 'Download a backup' })).toBeEnabled();

  /*
   * And the standing reminder stands down only for as long as that card is really there.
   *
   * Money is entered without leaving the page — an in-app link, not a reload — so this is still the one
   * open the card belongs to, and there is now data on this device that has never been backed up. The
   * reminder is due at its loudest and is held back only because the card above it says more than it
   * could. Putting that card away without downloading anything has to bring it back in the same breath:
   * a phone left in a pocket for a fortnight never reloads, and that is exactly the user the thirty-day
   * promise is for.
   */
  await page.getByRole('navigation').getByRole('link', { name: 'Accounts', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Entered after the update');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('1000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Entered after the update' })).toBeVisible();

  const reminder = page.getByText('You have not backed up yet.');
  await expect(reminder).toHaveCount(0);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByText(`Your data was updated to version ${LATEST_VERSION}`)).toHaveCount(0);
  await expect(reminder).toBeVisible();
});

/**
 * The open after an update has nothing to say, and says nothing.
 *
 * That and no more: this is the ordinary launch with no migrations pending, and it asserts only that such
 * an open never shows a progress screen. An update interrupted half-way is a different launch, not tested
 * here — what happens to the versions that had already committed is proved, in the engine rather than in
 * the browser, by `packages/db/test/migration-safety.test.ts`.
 */
test('an open with nothing to update shows no progress screen', async ({ page }) => {
  await watchTheOpening(page);
  await addBank(page, 'Nothing to do', '1000000');

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Nothing to do' })).toBeVisible();
  const seen = await whatWasOnScreen(page);
  // The watcher was awake for this load — otherwise the three assertions below would pass on an empty list.
  expect(seen.some((text) => text.includes('Add account')), `screens seen: ${seen.join(' | ')}`).toBe(true);
  expect(seen.filter((text) => text.includes('Updating your data…')), `screens seen: ${seen.join(' | ')}`).toEqual([]);
  expect(seen.filter((text) => text.includes('Taking a copy first…'))).toEqual([]);
  expect(seen.filter((text) => text.includes('Checking your data…'))).toEqual([]);
  await expect(page.getByText(/Your data was updated to version/)).toHaveCount(0);
});
