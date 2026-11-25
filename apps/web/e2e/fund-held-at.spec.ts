import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fundByMoney, institutionRow, setInstitution } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a fund’s Institution is picked from the brokers’ cash accounts only, never a bank or wallet account', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet Hijau', balance: '300000' });
  await openAccount(page, { subtype: 'fund', name: 'Contoh Sekuritas', balance: '2000000' });
  await fundByMoney(page);
  await expect(institutionRow(page)).toContainText('Not set');
  await institutionRow(page).getByRole('button').click();
  const sheet = page.getByRole('dialog', { name: 'Institution', exact: true });
  await expect(sheet.getByRole('button', { name: 'Contoh Sekuritas', exact: true })).toBeVisible();
  // The bank (BCA) and the wallet are never offered: a fund never reads as linked to a bank account.
  await expect(sheet.getByRole('button', { name: /BCA/ })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /Dompet Hijau/ })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Contoh Sekuritas', exact: true }).click();
  await expect(institutionRow(page)).toContainText('Contoh Sekuritas');
  await page.reload();
  await expect(institutionRow(page)).toContainText('Contoh Sekuritas');

  // None lets the link go.
  await setInstitution(page, 'none');
  await page.reload();
  await expect(institutionRow(page)).toContainText('Not set');
});

test('a place with no account is typed under Other place…, kept by name and linked to nothing', async ({ page }) => {
  await fundByMoney(page);
  await setInstitution(page, { other: 'Bibit' });
  await page.reload();
  await expect(institutionRow(page)).toContainText('Bibit');
  // Opened again, Other place shows the name and the typing starts from it.
  await institutionRow(page).getByRole('button').click();
  await expect(page.getByRole('dialog', { name: 'Institution', exact: true }).getByRole('button', { name: /^Other place/ })).toContainText('Bibit');
  await page.keyboard.press('Escape');

  // The bank account lists nothing held at the bank: the fund is not linked to it.
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^BCA/ }).first().click();
  await expect(page.getByTestId('institution-holding')).toHaveCount(0);
});
