import { expect, test } from '@playwright/test';
import { openSettings } from './accounts';
import { bbcaAt, expectBrokerBalance, openBroker, openBrokerSettings } from './listed-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: two lots of BBCA bought at a stepped price, paid from the broker’s RDN', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'More price' }).click();
  await sheet.getByRole('button', { name: 'More lots' }).click();
  await expect(page.getByTestId('trade-total')).toContainText('Rp 1.236.853');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('12 lots');
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '6.763.147');
});

test('phone: a sell of more lots than are held is refused, and a broker’s fees are edited on its account', async ({ page }) => {
  await openBroker(page, 'Mandiri Sekuritas', '8000000');
  await bbcaAt(page, 'Mandiri Sekuritas');
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Lots', { exact: true }).fill('11');
  await expect(page.getByRole('dialog')).toContainText('cannot sell more than that');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();

  await openBrokerSettings(page, 'Mandiri Sekuritas');
  await expect(page.getByLabel('Minimum fee per day', { exact: true })).toHaveValue('5.000');
  await page.getByLabel('Sell fee %', { exact: true }).fill('0,3');
  await page.getByLabel('Buy fee %', { exact: true }).click();
  // Saved as the row is left: the page read again (back, and in again) shows it once the save has landed.
  await expect(async () => {
    await page.getByRole('button', { name: 'Mandiri Sekuritas', exact: true }).click();
    await openSettings(page);
    await expect(page.getByLabel('Sell fee %', { exact: true })).toHaveValue('0,3', { timeout: 1_000 });
  }).toPass();
});
