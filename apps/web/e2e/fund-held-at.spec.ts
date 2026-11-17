import { expect, test } from '@playwright/test';
import { openFace } from './accounts';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a fund is held at an institution by name, never an account: a bank account with no bank named is not offered', async ({ page }) => {
  await fundByMoney(page);
  const held = page.getByLabel('Institution', { exact: true });
  await expect(held).toHaveValue('');
  // A typed name is the fund's Nama institusi, saved when the field is left (the offers above the keyboard are a
  // phone's: phone-fund-institution).
  await held.fill('Bibit');
  await held.blur();
  await expect(held).toHaveValue('Bibit');
  await page.reload();
  await expect(page.getByLabel('Institution', { exact: true })).toHaveValue('Bibit');

  // The bank account lists nothing held at the bank: the fund is not linked to it.
  await page.goto('/wallet');
  await openFace(page.getByRole('link', { name: /^BCA/ }).first());
  await expect(page.getByTestId('institution-holding')).toHaveCount(0);
});
