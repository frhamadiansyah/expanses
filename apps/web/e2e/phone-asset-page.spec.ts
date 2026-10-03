import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addEstimated, addPriced, openAsset, priceSaid, typePrice } from './asset-page';

test('by thumb: gold’s grid and purchases, and a laptop valued again from its sheet', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2025-09-19', '10', '20395000']]);
  await openAsset(page, 'Antam gold bars');
  await typePrice(page, '2485000');
  await expect(page.getByTestId('asset-card').getByTestId('asset-grid')).toContainText('Typed price');
  await expect(page.getByTestId('asset-card')).toContainText('30 days ago');
  await expect(await priceSaid(page, 'Typed price')).toContainText('Typed · ');
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

test('by thumb: Assets divides its total into boxes, and a tapped box shows that section alone', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '9000000' });
  await addEstimated(page, 'Electronics', 'Laptop', '2024-01-05', '22000000', '14000000');
  await page.goto('/net-worth/assets');

  // Cash and the laptop's section, one box each, each naming itself.
  await expect(page.getByTestId('share-boxes').getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('share-box-liquid')).toContainText('Rp 9.000.000');
  const groups = page.locator('[data-testid^="type-drawer-"]');
  await expect(groups).toHaveCount(2);

  // The laptop's section picked: only its drawer, already open on the laptop.
  await page.getByTestId('share-box-other').tap();
  await expect(groups).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Laptop/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /BCA Tahapan/ })).toHaveCount(0);

  await page.getByTestId('show-all').tap();
  await expect(groups).toHaveCount(2);
  // Let go, the drawers are shut again: the whole list is a handful of kinds.
  await expect(page.getByRole('link', { name: /Laptop/ })).toHaveCount(0);
});
