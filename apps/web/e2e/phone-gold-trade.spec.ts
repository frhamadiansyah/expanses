import { expect, test } from '@playwright/test';
import { goldAtPrice } from './gold-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('phone: the brand’s bar sizes ride over the keyboard while Grams is typed, and one tap fills it', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const strip = page.getByRole('listbox', { name: 'Bar sizes' });
  await expect(strip).toHaveCount(0);
  const grams = sheet.getByLabel('Grams', { exact: true });
  await grams.focus();
  await expect(strip).toBeVisible();
  // UBS's own sizes: a 4 g bar, and nothing past 100 g.
  await expect(strip.getByRole('option', { name: '4 g', exact: true })).toHaveCount(1);
  await expect(strip.getByRole('option', { name: '1.000 g', exact: true })).toHaveCount(0);
  await strip.getByRole('option', { name: '5 g', exact: true }).click();
  await expect(grams).toHaveValue('5');
  await expect(grams).toBeFocused();
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9850000');
  await expect(strip).toHaveCount(0);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('17 g');
});

test('phone: All sells every gram, down to 0 g, and more than is held is refused', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('12,5');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await sheet.getByLabel('Received', { exact: true }).pressSequentially('22000000');
  await expect(page.getByTestId('gold-gain')).toContainText('−Rp 500.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('0 g');
});
