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
  const copies = page.getByRole('heading', { name: 'Safety copies on this device' }).locator('..');
  await expect(copies).toContainText('The day’s copy');
  await expect(copies).toContainText('not a backup');

  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await copies.getByRole('button', { name: 'Restore this copy' }).first().click();
  expect((await safety).suggestedFilename()).toMatch(/^expanses-before-restore-\d{4}-\d{2}-\d{2}\.sqlite3$/);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with the copy from/ }).click()]);

  // What the copy held is back, and what was entered after it was taken is not.
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'In the copy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Added afterwards' })).toHaveCount(0);
});

test('the iPhone paragraph promises only what has been checked', async ({ page }) => {
  await page.goto('/backup');
  const section = page.getByRole('heading', { name: 'Backups and your iPhone' }).locator('..');
  await expect(section).toContainText("your data sits in the app's own container, which iCloud and Finder back up with the rest of the phone");
  await expect(section).toContainText('Deleting the app deletes that copy too.');
});
