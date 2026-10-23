import { expect, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a fund is held at an institution by name, never an account: a bank account with no bank named is not offered', async ({ page }) => {
  await fundByMoney(page);
  const held = page.getByLabel('Held at', { exact: true });
  await expect(held).toHaveValue('');
  await expect(page.getByText('A name only, for the tax report: not linked to any account.')).toBeVisible();
  // The bank account here names no bank, so its own name is not a choice: it would read as the account itself.
  await expect(held.locator('option', { hasText: /^BCA/ })).toHaveCount(0);

  // An institution typed: its name is the fund's Nama institusi, and from then on one of the choices.
  await held.selectOption({ label: 'Another…' });
  const name = page.getByLabel('Place name');
  await name.fill('Bibit');
  await name.blur();
  // Saved once the typed name is one of the choices.
  await expect(held).toHaveValue('Bibit');
  await page.reload();
  await expect(page.getByLabel('Held at', { exact: true })).toHaveValue('Bibit');

  // The bank account lists nothing held at the bank: the fund is not linked to it.
  await page.goto('/accounts');
  await page.getByRole('link', { name: /^BCA/ }).first().click();
  await expect(page.getByTestId('institution-holding')).toHaveCount(0);
});
