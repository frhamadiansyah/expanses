import { expect, test } from '@playwright/test';
import { openAsset } from './asset-page';
import { openSettings } from './accounts';
import { bbcaAt, expectBrokerBalance, openBroker, openBrokerSettings } from './listed-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('Buy BBCA: a price stepped on IDX’s tick, two lots, the broker’s fee, and the RDN pays exactly the total', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Buy BBCA' })).toBeVisible();
  await expect(sheet).toContainText(/Last close 6\.150 · \d{1,2} \w{3} \d{4}/);
  await expect(sheet.getByLabel('Price', { exact: true })).toHaveValue('6.150');
  await sheet.getByRole('button', { name: 'More price' }).click();
  await expect(sheet.getByLabel('Price', { exact: true })).toHaveValue('6.175');
  await sheet.getByRole('button', { name: 'More lots' }).click();
  // 200 shares at 6.175 is 1.235.000; 0,15% of it is 1.852,5, a whole 1.853.
  const total = page.getByTestId('trade-total');
  await expect(total).toContainText('Total · 200 shares');
  await expect(total).toContainText('Rp 1.236.853');
  await expect(total).toContainText('Rp 1.235.000 + fee Rp 1.853 (0,15%) · from Stockbit Sekuritas');
  // A price between IDX's steps is refused until it is on one.
  await sheet.getByLabel('Price', { exact: true }).fill('6.160');
  await expect(sheet).toContainText('IDX prices move in steps of 25 at this price');
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await sheet.getByLabel('Price', { exact: true }).fill('6.175');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('12 lots');
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '6.763.147');
});

test('Sell BBCA: what reaches the RDN after the fee, the gain on the lots sold, and no more lots than are held', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '0');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Lots', { exact: true }).fill('5');
  // 500 at 6.150 is 3.075.000; 0,25% is 7.687,5, a whole 7.688 with the 0,1% tax in it; 500 cost 4.375.000.
  const total = page.getByTestId('trade-total');
  await expect(total).toContainText('Selling · 500 shares of 1.000 held');
  await expect(total).toContainText('Rp 3.067.312');
  await expect(total).toContainText('Rp 3.075.000 − fee Rp 7.688 (0,25%, tax included) · into Stockbit Sekuritas');
  await expect(page.getByTestId('trade-gain')).toContainText('Gain on these 500: −Rp 1.304.613 (bought at avg 8.750)');

  await sheet.getByLabel('Lots', { exact: true }).fill('11');
  await expect(sheet).toContainText('Held: 10 lots; cannot sell more than that');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  await sheet.getByLabel('Lots', { exact: true }).fill('10');
  await expect(sheet.getByRole('button', { name: 'More lots' })).toBeDisabled();
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '6.134.625');
});

test('Mandiri Sekuritas’ Rp 5.000 minimum a day is charged on a small buy, and said', async ({ page }) => {
  await openBroker(page, 'Mandiri Sekuritas', '8000000');
  await bbcaAt(page, 'Mandiri Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  // 0,18% of 615.000 is 1.107, under the day's minimum.
  const total = page.getByTestId('trade-total');
  await expect(total).toContainText('Rp 620.000');
  await expect(total).toContainText('fee Rp 5.000 (0,18%) · from Mandiri Sekuritas · minimum fee Rp 5.000 applies');
});

test('a broker’s fees are set on its cash account, and the Buy sheet works from them', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await openBrokerSettings(page, 'Stockbit Sekuritas');
  await expect(page.getByLabel('Buy fee %', { exact: true })).toHaveValue('0,15');
  await expect(page.getByLabel('Sell fee %', { exact: true })).toHaveValue('0,25');
  await page.getByLabel('Buy fee %', { exact: true }).fill('0,19');
  await page.getByLabel('Minimum fee per day', { exact: true }).click();
  // Saved as the row is left: the page read again (back, and in again) shows it once the save has landed.
  await expect(async () => {
    await page.getByRole('button', { name: 'Stockbit Sekuritas', exact: true }).click();
    await openSettings(page);
    await expect(page.getByLabel('Buy fee %', { exact: true })).toHaveValue('0,19', { timeout: 1_000 });
  }).toPass();

  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  // 0,19% of 615.000 is 1.168,5, a whole 1.169.
  await expect(page.getByTestId('trade-total')).toContainText('Rp 615.000 + fee Rp 1.169 (0,19%)');
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Fee/)).toHaveValue('1.169');
  await openAsset(page, 'BBCA');
});
