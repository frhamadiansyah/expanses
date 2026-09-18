import { expect, test } from '@playwright/test';

test('a digital wallet and a fund account hold money, and the wallet pays for lunch', async ({ page }) => {
  await page.goto('/accounts');

  await page.getByLabel('Name', { exact: true }).fill('GoPay');
  await page.getByLabel('Type').selectOption('ewallet');
  await page.getByLabel('Current balance').fill('500000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'GoPay', exact: true })).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('RDN Mandiri Sekuritas');
  await page.getByLabel('Type').selectOption('fund');
  await page.getByLabel('Current balance').fill('8000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'RDN Mandiri Sekuritas', exact: true })).toBeVisible();

  // Both are named the way the type list names them.
  await expect(page.getByText('Digital wallet · IDR')).toBeVisible();
  await expect(page.getByText('Fund account · IDR')).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Warung Tegal');
  await page.getByLabel('Paid with').selectOption({ label: 'GoPay (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill('45000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Warung Tegal')).toBeVisible();

  await page.goto('/accounts');
  const wallet = page.locator('li', { has: page.getByRole('link', { name: 'GoPay', exact: true }) });
  await expect(wallet).toContainText('455.000');
  const fund = page.locator('li', { has: page.getByRole('link', { name: 'RDN Mandiri Sekuritas', exact: true }) });
  await expect(fund).toContainText('8.000.000');

  // Both are money the owner holds, so net worth counts them and the wallet's spending came off it.
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('8.455.000');
});
