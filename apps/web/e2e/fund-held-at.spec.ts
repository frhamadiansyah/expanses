import { expect, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a fund is held at a bank, and the bank lists it; or at a place typed by name', async ({ page }) => {
  await fundByMoney(page);
  const held = page.getByLabel('Held at', { exact: true });
  await expect(held).toHaveValue('none');
  await held.selectOption({ label: 'BCA' });
  await expect(held).toHaveValue(/.+/);
  await expect(page.getByLabel('Place name')).toHaveCount(0);

  // The bank's own page lists the fund held there.
  await page.goto('/accounts');
  await page.getByRole('link', { name: /^BCA/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Funds held here' })).toBeVisible();
  await expect(page.getByTestId('broker-holding')).toContainText(FUND);
  await page.getByTestId('broker-holding').click();

  // Somewhere not in the app: its name, kept for the tax report.
  await page.getByLabel('Held at', { exact: true }).selectOption({ label: 'Somewhere not in the app' });
  const name = page.getByLabel('Place name');
  await name.fill('Bibit');
  await name.blur();
  await page.reload();
  await expect(page.getByLabel('Held at', { exact: true })).toHaveValue('typed');
  await expect(page.getByLabel('Place name')).toHaveValue('Bibit');
});
