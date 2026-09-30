import { expect, test } from '@playwright/test';
import { addEstimated, addPriced, openAsset, typePrice } from './asset-page';

test('by thumb: gold’s grid and purchases, and a laptop valued again from its sheet', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2025-09-19', '10', '20395000']]);
  await openAsset(page, 'Antam gold bars');
  await typePrice(page, '2485000');
  await expect(page.getByTestId('asset-card').getByTestId('asset-grid')).toContainText('Your price');
  await expect(page.getByTestId('asset-card')).toContainText('30 days ago');
  await expect(page.getByTestId('price-line')).toContainText('Typed · ');
  await expect(page.getByTestId('asset-history-row').first()).toContainText('+Rp 4.455.000');

  await addEstimated(page, 'Electronics', 'Laptop', '2024-01-05', '22000000', '14000000');
  await openAsset(page, 'Laptop');
  await expect(page.getByTestId('asset-gain')).toHaveAttribute('data-tone', 'loss');
  await page.getByRole('button', { name: 'Update value' }).tap();
  await expect(page.getByLabel('Value (IDR)')).toHaveValue('');
  await page.getByLabel('Value (IDR)').fill('12000000');
  await page.getByRole('button', { name: 'Save value' }).tap();
  await expect(page.getByTestId('asset-gain')).toHaveText('−Rp 10.000.000 · −45,5%');
  await expect(page.getByTestId('asset-history-row').first()).toContainText('My estimate');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
