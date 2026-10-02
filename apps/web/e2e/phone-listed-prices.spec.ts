import { expect, test } from '@playwright/test';
import { openAsset, priceSaid } from './asset-page';
import { holdBbca, IDX_FILE, routeYahoo, yesterdayOnIdx } from './listed-prices';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: BBCA shows Yahoo Finance’s last close behind its ⓘ, and the Price source sheet offers three', async ({ page }) => {
  await routeYahoo(page, { close: 6_150 });
  await holdBbca(page);
  await openAsset(page, 'BBCA');
  await expect(await priceSaid(page, 'Last close')).toHaveText(`Yahoo Finance close · ${yesterdayOnIdx().label}. Delayed; the last close, not a live price.`);
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
  await page.getByRole('button', { name: /^Price source/ }).click();
  await expect(page.getByRole('dialog').getByRole('button')).toContainText([/Yahoo Finance/, /IDX daily file/, /I'll type it/]);
});

test('phone: offline keeps the last close and asks nothing of the page', async ({ page }) => {
  await routeYahoo(page, { close: 6_150 });
  await holdBbca(page);
  await openAsset(page, 'BBCA');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
  await routeYahoo(page, 'offline');
  await priceSaid(page, 'Last close');
  await page.getByRole('button', { name: 'Fetch the latest close' }).click();
  await expect(page.getByTestId('price-said')).toContainText('↻ to try again');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
});

test('phone: IDX’s daily file, chosen from Update prices, previews and saves the close', async ({ page }) => {
  await routeYahoo(page, 'offline');
  await holdBbca(page);
  await openAsset(page, 'BBCA');
  await page.getByRole('link', { name: 'Update prices' }).click();
  await page.getByRole('button', { name: 'Import IDX daily file' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose the downloaded file' }).click();
  await (await chooser).setFiles(IDX_FILE);
  await expect(page.getByTestId('idx-preview')).toContainText('1 held stock found · 4 others skipped');
  await page.getByRole('button', { name: 'Save 1 price' }).click();
  await expect(page.getByTestId('idx-preview')).toHaveCount(0);
  await openAsset(page, 'BBCA');
  await expect(await priceSaid(page, 'Last close')).toHaveText('IDX closing price · 29 Sep 2026');
});
