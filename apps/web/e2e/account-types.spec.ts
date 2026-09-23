import { expect, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

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
  await addTransaction(page, { description: 'Warung Tegal', paidWith: 'GoPay', category: 'Groceries', amount: '45000' });
  await expect(page.getByText('Warung Tegal')).toBeVisible();

  await page.goto('/accounts');
  // An account is a table row now — the same five columns, scrollable at 390 px rather than wrapping the name
  // into the balance. The row still holds the name as a link into its history, so the locator is the same fact.
  const wallet = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'GoPay', exact: true }) });
  await expect(wallet).toContainText('455.000');
  const fund = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'RDN Mandiri Sekuritas', exact: true }) });
  await expect(fund).toContainText('8.000.000');

  // Both are money the owner holds, so net worth counts them and the wallet's spending came off it.
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('8.455.000');
});

test('a deposit funded from an account moves the money, and says where it came from', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Current balance').fill('100000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('bluuu');
  await page.getByLabel('Type').selectOption('time_deposit');
  await page.getByLabel('Current balance').fill('50000000');
  // The question is asked only once there is a figure to ask about, and the account it names is the answer.
  await page.getByLabel('Where the money comes from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Matures on').fill('2026-12-02');
  await page.getByRole('button', { name: 'Add account' }).click();

  // Both balances moved: the bank lost what the deposit holds, and net worth did not gain the money twice.
  const bank = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'BCA Tahapan', exact: true }) });
  await expect(bank).toContainText('50.000.000');
  const deposit = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'bluuu', exact: true }) });
  await expect(deposit).toContainText('50.000.000');
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('100.000.000');

  // Its history says Transfer and names both accounts — not an opening balance appearing out of nowhere.
  await page.goto('/accounts');
  await page.getByRole('link', { name: 'bluuu', exact: true }).click();
  const row = page.getByRole('main').getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Transfer');
  await expect(row).toContainText('bluuu');
  await expect(row).toContainText('BCA Tahapan');
  await expect(row).not.toContainText('Opening balance');
});
