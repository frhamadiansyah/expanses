import { expect, test } from '@playwright/test';
import { fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: a fund’s Institution offers the places that sell funds as it is typed, never a bank account’s own name', async ({ page }) => {
  await fundByMoney(page);
  const held = page.getByLabel('Institution', { exact: true });
  const offered = page.getByRole('listbox', { name: 'Institutions' });

  // A fund app comes before the broker also known by its name.
  await held.fill('Bi');
  await expect(offered.getByRole('option').first()).toHaveAccessibleName('Bibit');

  // The bank account here names no bank, so its own name ("BCA") is never offered: it would read as the account.
  await held.fill('BC');
  await expect(offered.getByRole('option', { name: 'BCA', exact: true })).toHaveCount(0);
  await expect(offered.getByRole('option', { name: 'BCA Sekuritas' })).toBeVisible();

  // A picked name is saved at once, and stays.
  await held.fill('Bi');
  await offered.getByRole('option', { name: 'Bibit' }).click();
  await expect(held).toHaveValue('Bibit');
  await page.reload();
  await expect(page.getByLabel('Institution', { exact: true })).toHaveValue('Bibit');
});
