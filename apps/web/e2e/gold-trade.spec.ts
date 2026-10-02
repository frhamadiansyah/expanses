import { expect, test } from '@playwright/test';
import { GOLD, goldAtPrice } from './gold-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('Buy gold bars: grams and the receipt’s total, and the holding gains both', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Buy' })).toBeVisible();
  const holding = page.getByTestId('trade-holding');
  await expect(holding).toContainText(GOLD);
  await expect(holding).toContainText(/12 g · last Rp\s1\.950\.000\/g · \d{1,2} \w{3} \d{4}/);
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await sheet.getByLabel('Grams', { exact: true }).fill('5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9850000');
  await expect(sheet.getByLabel('Total paid', { exact: true })).toHaveValue('9.850.000');
  await sheet.getByRole('button', { name: 'About Total paid' }).click();
  await expect(sheet).toContainText("Type the receipt's total");
  // Nothing to work out on a buy.
  await expect(page.getByTestId('gold-gain')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  const grid = page.getByTestId('asset-grid');
  await expect(grid).toContainText('17 g');
  await expect(grid).toContainText('32.350.000');
});

test('Sell gold bars: the gain against the average cost, no more grams than are held, and All ends at 0 g', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sell' })).toBeVisible();
  await expect(page.getByTestId('trade-holding')).toContainText(/12 g · cost Rp\s1\.875\.000\/g/);
  const grams = sheet.getByLabel('Grams', { exact: true });
  await grams.fill('2');
  await sheet.getByLabel('Received', { exact: true }).pressSequentially('3640000');
  // 2 g at the average 1.875.000 cost 3.750.000.
  await expect(page.getByTestId('gold-gain')).toContainText('−Rp 110.000');

  await grams.fill('13');
  await expect(sheet).toContainText('More than the 12 g held');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();

  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(grams).toHaveValue('12');
  await sheet.getByLabel('Received', { exact: true }).fill('24000000');
  await expect(page.getByTestId('gold-gain')).toContainText('+Rp 1.500.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('0 g');
});

test('More options opens the full form with the grams, the total and the account in it', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('0,5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('985000');
  await page.getByRole('button', { name: 'More options' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel(/^Units, shares or grams/)).toHaveValue('0,5');
  await expect(form.getByLabel(/^What it cost/)).toHaveValue('985.000');
});
