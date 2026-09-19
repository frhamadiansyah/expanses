import { expect, test } from '@playwright/test';
import { addBank, corruptTheDatabase, CORRUPT_HEADLINE, EXPORT_BUTTON, forgetSafetyCopies, safetyCopies, waitForSafetyCopy } from './recovery-fixture';

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
