import { expect, test } from '@playwright/test';
import { addBank, corruptTheDatabase, CORRUPT_HEADLINE, EXPORT_BUTTON } from './recovery-fixture';

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

/** The first press, on the screen a corrupt file actually produces: what goes, and the gate in front of it. */
test('start fresh needs two presses and says what it deletes', async ({ page }) => {
  await addBank(page, 'About to go', '1000000');
  await corruptTheDatabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start fresh on this device', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Start fresh' });
  await expect(sheet.getByText('It cannot be undone.')).toBeVisible();
  // The size is read off the device itself, so the list is what is really about to go.
  await expect(sheet.getByRole('listitem').filter({ hasText: /Your data on this device — [\d.]+ MB/ })).toBeVisible();
  await expect(sheet.getByRole('listitem').filter({ hasText: 'No kept copies on this device' })).toBeVisible();

  const confirm = sheet.getByRole('button', { name: 'Delete everything on this device', exact: true });
  await expect(confirm).toBeDisabled();
  await sheet.getByLabel('I already have a backup').check();
  await expect(confirm).toBeEnabled();
  // The press itself is the next test. After a *failed* open the worker still holds the pool's sync
  // access handles, so the wipe cannot acquire them; releasing it belongs to Task 7, not here.
});

test('start fresh from the recovery tools empties a device whose file will not open', async ({ page }) => {
  await addBank(page, 'About to go', '1000000');
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
});
