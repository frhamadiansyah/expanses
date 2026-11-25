import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillFigure } from './add-transaction';
import { openNewAsset } from './add-asset';
import { openAsset } from './asset-page';
import { fundByMoney, institutionRow, setInstitution } from './fund-trade';
import { pickTradeCash } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

const paymentRow = (page: Page) => page.getByRole('dialog').getByRole('button', { name: /^Payment method/ });

test('phone: a fund’s Buy asks for the account until one is named, then starts on the last one used', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  // No Institution linked and no trade with an account yet: nothing is chosen for her, not the first account.
  await expect(paymentRow(page)).not.toContainText('BCA');
  await fillFigure(sheet, 'Amount', '500000');
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await pickTradeCash(page, sheet, 'Payment method', 'BCA');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);

  // The next one starts where the last went from.
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(paymentRow(page)).toContainText('BCA');
});

test('phone: a fund’s Buy and Sell start on the broker’s cash its Institution links to, ahead of the last trade', async ({ page }) => {
  await openAccount(page, { subtype: 'fund', name: 'Contoh Sekuritas', balance: '2000000' });
  await fundByMoney(page);
  // A buy from the bank first: the link still wins over it.
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await fillFigure(sheet, 'Amount', '100000');
  await pickTradeCash(page, sheet, 'Payment method', 'BCA');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);

  await setInstitution(page, { broker: 'Contoh Sekuritas' });
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(paymentRow(page)).toContainText('Contoh Sekuritas');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Received into/ })).toContainText('Contoh Sekuritas');
});

test('phone: a new fund picks its Institution as it is added; a new purchase is paid from it, and Buy starts there', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '10000000' });
  await openAccount(page, { subtype: 'fund', name: 'Contoh Sekuritas', balance: '5000000' });
  await openNewAsset(page, 'Mutual fund');
  await page.getByLabel('Name', { exact: true }).fill('Pasar Uang Contoh');
  await institutionRow(page).getByRole('button').click();
  const list = page.getByRole('dialog', { name: 'Institution', exact: true });
  // Brokers' cash only: the bank is never offered.
  await expect(list.getByRole('button', { name: /BCA/ })).toHaveCount(0);
  await list.getByRole('button', { name: /^Contoh Sekuritas/ }).click();
  await expect(institutionRow(page)).toContainText('Contoh Sekuritas');
  // A new purchase is paid from the broker's cash picked.
  await expect(page.getByRole('button', { name: /^Payment method/ })).toContainText('Contoh Sekuritas');
  await page.getByLabel('Amount', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await openAsset(page, 'Pasar Uang Contoh');
  await expect(institutionRow(page)).toContainText('Contoh Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(paymentRow(page)).toContainText('Contoh Sekuritas');
});
