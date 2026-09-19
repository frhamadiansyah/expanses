import { expect, test } from '@playwright/test';
import { overdueBanner, restoreAgedByDays } from './backup-reminders-fixture';
import { addBank } from './recovery-fixture';

test('the overdue reminder fits a phone, and its buttons can be hit with a thumb', async ({ page }, testInfo) => {
  await addBank(page, 'Needs backing up', '1000000');
  await restoreAgedByDays(page, testInfo.outputPath('aged.sqlite3'), 31);

  await page.goto('/transactions');
  const banner = overdueBanner(page, 31);
  await expect(banner).toBeVisible();

  // The reminder must not be the thing that makes the phone scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  for (const name of ['Download backup', 'Not now']) {
    const box = await banner.getByRole('button', { name }).boundingBox();
    expect(box, `${name} has no box`).not.toBeNull();
    expect(box!.height, `${name} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
  }

  const download = page.waitForEvent('download');
  await banner.getByRole('button', { name: 'Download backup' }).click();
  await download;
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(/\/transactions/);
});
