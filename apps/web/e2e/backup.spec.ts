import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

async function addBank(page: Page, name: string, balance: string) {
  await openAccount(page, { subtype: 'bank', name, balance });
}

test('restore replaces data only after a safety copy downloads and is confirmed', async ({ page }) => {
  await addBank(page, 'Before backup', '1000000');

  await page.goto('/backup');
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = await backupDownload;
  const backupPath = await backup.path();

  await addBank(page, 'After backup', '5000');

  await page.goto('/backup');
  page.once('dialog', (dialog) => void dialog.accept());
  const safetyDownload = page.waitForEvent('download');
  await page.locator('input[accept*="sqlite3"]').setInputFiles(backupPath);
  const safety = await safetyDownload;
  expect(safety.suggestedFilename()).toMatch(/^expanses-before-restore-\d{4}-\d{2}-\d{2}\.sqlite3$/);

  // Restore reloads the page; wait for the new document before navigating.
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Before backup', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'After backup', exact: true })).toHaveCount(0);
});
