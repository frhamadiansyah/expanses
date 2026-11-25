import { expect, test } from '@playwright/test';
import { fundByMoney, institutionRow } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: Other place offers the places that sell funds as it is typed, never a bank account’s own name', async ({ page }) => {
  await fundByMoney(page);
  await institutionRow(page).getByRole('button').click();
  await page.getByRole('dialog', { name: 'Institution', exact: true }).getByRole('button', { name: /^Other place/ }).click();
  const other = page.getByRole('dialog', { name: 'Other place', exact: true });
  const held = other.getByLabel('Name', { exact: true });
  const offered = page.getByRole('listbox', { name: 'Institutions' });

  // A fund app comes before the broker also known by its name.
  await held.fill('Bi');
  await expect(offered.getByRole('option').first()).toHaveAccessibleName('Bibit');

  // The bank account here names no bank, so its own name ("BCA") is never offered: it would read as the account.
  await held.fill('BC');
  await expect(offered.getByRole('option', { name: 'BCA', exact: true })).toHaveCount(0);
  await expect(offered.getByRole('option', { name: 'BCA Sekuritas' })).toBeVisible();

  // A picked name is kept once saved, and stays.
  await held.fill('Bi');
  await offered.getByRole('option', { name: 'Bibit' }).click();
  await expect(held).toHaveValue('Bibit');
  await other.getByRole('button', { name: 'Save place' }).click();
  await expect(institutionRow(page)).toContainText('Bibit');
  await page.reload();
  await expect(institutionRow(page)).toContainText('Bibit');
});
