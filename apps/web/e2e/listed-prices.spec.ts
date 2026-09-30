import { expect, test } from '@playwright/test';
import { openAsset, priceSaid } from './asset-page';
import { forgetYahooAsks, holdBbca, IDX_FILE, routeYahoo, yesterdayOnIdx } from './listed-prices';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a BBCA holding follows Yahoo Finance: the last close, said by name with its day, and three sources to choose from', async ({ page }) => {
  await routeYahoo(page, { close: 6_150 });
  await holdBbca(page);
  await openAsset(page, 'BBCA');
  const { label } = yesterdayOnIdx();
  await expect(await priceSaid(page, 'Last close')).toHaveText(`Yahoo Finance close · ${label}. Delayed; the last close, not a live price.`);
  // 10 lots of 100 at 6.150.
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 6.150');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fetch the latest close' })).toBeVisible();

  await page.getByRole('button', { name: /^Price source/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: /^Yahoo Finance/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: /^IDX daily file/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^I'll type it/ })).toBeVisible();
});

test('a share set to “I’ll type it” never asks Yahoo, and keeps its price', async ({ page }) => {
  const yahoo = await routeYahoo(page, { close: 6_150 });
  await holdBbca(page);
  await openAsset(page, 'BBCA');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
  await page.getByRole('button', { name: /^Price source/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^I'll type it/ }).click();
  await expect(page.getByRole('button', { name: /^Price source/ })).toContainText("I'll type it");
  await expect(page.getByRole('button', { name: 'Fetch the latest close' })).toHaveCount(0);

  // A new day as far as the app knows: it would ask again, if the share still followed Yahoo.
  await forgetYahooAsks(page);
  const before = yahoo.asked();
  await page.reload();
  await expect(page.getByText('Value now')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(yahoo.asked()).toBe(before);
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
});

test('offline, the last close stays with its day and ↻ offers to try again', async ({ page }) => {
  await routeYahoo(page, { close: 6_150 });
  await holdBbca(page);
  await openAsset(page, 'BBCA');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();

  await routeYahoo(page, 'offline');
  // ↻ sits with the explanation behind the price's ⓘ.
  await priceSaid(page, 'Last close');
  await page.getByRole('button', { name: 'Fetch the latest close' }).click();
  const { label } = yesterdayOnIdx();
  await expect(page.getByTestId('price-said')).toHaveText(`Yahoo Finance close · ${label} · ↻ to try again. Delayed; the last close, not a live price.`);
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
});

test('IDX’s daily file fills the shares held: a preview, one save, and the page says where the price came from', async ({ page }) => {
  await routeYahoo(page, 'offline');
  await holdBbca(page);
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Stock and fund prices' }).click();
  await expect(page.getByRole('heading', { name: 'Update prices' })).toBeVisible();
  await expect(page.getByLabel('BBCA', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Import IDX daily file' }).click();
  await expect(page.getByRole('button', { name: 'Open IDX website' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose the downloaded file' }).click();
  await (await chooser).setFiles(IDX_FILE);

  const preview = page.getByTestId('idx-preview');
  await expect(preview).toContainText('Closing prices for29 Sep 2026');
  await expect(preview).toContainText('1 of your stocks found · 4 others skipped');
  await expect(page.getByRole('dialog')).toContainText('No price → 6.150');
  await page.getByRole('button', { name: 'Save 1 price' }).click();
  await expect(page.getByTestId('idx-preview')).toHaveCount(0);
  await expect(page.getByText(/Last Rp\s?6\.150 · 29 Sep 2026 · IDX closing price/)).toBeVisible();

  await openAsset(page, 'BBCA');
  await expect(await priceSaid(page, 'Last close')).toHaveText('IDX closing price · 29 Sep 2026');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
});

test('a price typed on Update prices is today’s, and a file that is not IDX’s is refused in plain words', async ({ page }) => {
  await routeYahoo(page, 'offline');
  await holdBbca(page);
  await page.goto('/net-worth/prices');
  await page.getByLabel('BBCA', { exact: true }).fill('6.300');
  await page.getByRole('button', { name: 'Save prices' }).click();
  await expect(page.getByText(/Last Rp\s?6\.300 · \d{1,2} \w{3} \d{4} · Typed/)).toBeVisible();

  await page.getByRole('button', { name: 'Import IDX daily file' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose the downloaded file' }).click();
  await (await chooser).setFiles({ name: 'prices.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a spreadsheet') });
  await expect(page.getByRole('alert')).toContainText("This doesn't look like IDX's Ringkasan Saham file");
});
