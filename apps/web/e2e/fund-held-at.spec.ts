import { expect, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a fund is held at an institution, and an account at it lists it; or at one typed by name', async ({ page }) => {
  await fundByMoney(page);
  const held = page.getByLabel('Held at', { exact: true });
  await expect(held).toHaveValue('');
  // The institutions the accounts are at: the bank account here names none, so it stands for its own.
  await held.selectOption({ label: 'BCA' });
  await expect(held).toHaveValue('BCA');
  await expect(page.getByLabel('Place name')).toHaveCount(0);

  // An account at that institution lists the fund held there — held at the bank, not inside the account.
  await page.goto('/accounts');
  await page.getByRole('link', { name: /^BCA/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Also at BCA' })).toBeVisible();
  await expect(page.getByTestId('institution-holding')).toContainText(FUND);
  await page.getByTestId('institution-holding').click();

  // Another institution, typed: its name is the fund's Nama institusi, and from then on one of the choices.
  await page.getByLabel('Held at', { exact: true }).selectOption({ label: 'Another…' });
  const name = page.getByLabel('Place name');
  await name.fill('Bibit');
  await name.blur();
  await page.reload();
  await expect(page.getByLabel('Held at', { exact: true })).toHaveValue('Bibit');
});
