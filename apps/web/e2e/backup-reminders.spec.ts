import { expect, test } from '@playwright/test';
import { expireSnooze, overdueBanner, restoreAgedByDays } from './backup-reminders-fixture';
import { addBank, forgetSafetyCopies, waitForSafetyCopy } from './recovery-fixture';

test('a month without a backup is one press from fixed, and can be put off without nagging', async ({ page }, testInfo) => {
  await addBank(page, 'Needs backing up', '1000000');
  await restoreAgedByDays(page, testInfo.outputPath('aged.sqlite3'), 31);

  await page.goto('/transactions');
  const banner = overdueBanner(page, 31);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Your only copy is on this device.');

  // Always dismissible...
  await banner.getByRole('button', { name: 'Not now' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cashflow' })).toBeVisible();
  // ...and it stays dismissed, so it is never a thing to get rid of on every launch.
  await expect(overdueBanner(page, 31)).toHaveCount(0);

  // A week later it asks once more, and this time it is answered where it stands.
  await expireSnooze(page);
  await page.reload();
  const again = overdueBanner(page, 31);
  await expect(again).toBeVisible();

  const download = page.waitForEvent('download');
  await again.getByRole('button', { name: 'Download backup' }).click();
  expect((await download).suggestedFilename()).toMatch(/^expanses-backup-\d{4}-\d{2}-\d{2}\.sqlite3$/);
  await expect(again).toHaveCount(0);
  await expect(page).toHaveURL(/\/transactions/); // fixed in place, no trip to /backup
});

test('the backup screen lists the copies the app keeps, and restores one', async ({ page }) => {
  await addBank(page, 'In the copy', '250000');
  // A copy of exactly this: the day's copy may have been taken before the account was, so the device is
  // made to look like one that has not had a copy today and the next open takes one over what is here.
  await forgetSafetyCopies(page);
  await page.reload();
  await waitForSafetyCopy(page);
  await addBank(page, 'Added afterwards', '5000');

  await page.goto('/backup');
  // The group's heading sits outside it now, so the heading's parent is its own line rather than the whole card.
  const copies = page.locator('section', { has: page.getByRole('heading', { name: 'Safety copies on this device' }) });
  await expect(copies).toContainText('The day’s copy');
  await expect(copies).toContainText('not a backup');

  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  // The row is the action now — a row never holds a button — so it is named for the copy it restores.
  await copies.getByRole('button', { name: /Restore this copy from/ }).first().click();
  expect((await safety).suggestedFilename()).toMatch(/^expanses-before-restore-\d{4}-\d{2}-\d{2}\.sqlite3$/);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with the copy from/ }).click()]);

  // What the copy held is back, and what was entered after it was taken is not.
  await page.goto('/accounts');
  // Exact: the row's own "Filed as" link carries the name in its label too.
  await expect(page.getByRole('link', { name: 'In the copy', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Added afterwards', exact: true })).toHaveCount(0);

  /*
   * And the restore itself is undoable. A restore from the working app is the common one — the recovery
   * screen is the rare one — so it must leave the same `before-restore` copy behind: the download alone is
   * a file the user has to go and find again, and "Added afterwards" now exists nowhere else.
   */
  await page.goto('/backup');
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Safety copies on this device' }) })).toContainText('Taken before a restore');
});

test('the iPhone paragraph promises only what has been checked', async ({ page }) => {
  await page.goto('/backup');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Backups and your iPhone' }) });
  // Spec §8.2: no claim that a device backup covers this data until that has been checked on a device.
  await expect(section).toContainText('an iPhone backup does not carry your data with it');
  await expect(section).not.toContainText('back up with the rest of the phone');
  await expect(section).not.toContainText("sits in the app's own container");
  // And the one thing that is true today is still said plainly.
  await expect(section).toContainText('keep downloading a backup of your own');
});
