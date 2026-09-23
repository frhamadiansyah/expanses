import { expect, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { addTransaction } from './add-transaction';

test('a digital wallet and a fund account hold money, and the wallet pays for lunch', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '500000' });
  await openAccount(page, { subtype: 'fund', name: 'RDN Mandiri Sekuritas', balance: '8000000' });

  // Both are named the way the type list names them.
  await expect(page.getByText('Digital wallet · IDR')).toBeVisible();
  await expect(page.getByText('Fund account · IDR')).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Tegal', paidWith: 'GoPay', category: 'Groceries', amount: '45000' });
  await expect(page.getByText('Warung Tegal')).toBeVisible();

  await page.goto('/accounts');
  await openTypes(page);
  // An account is a table row now — the same five columns, scrollable at 390 px rather than wrapping the name
  // into the balance. The row still holds the name as a link into its history, so the locator is the same fact.
  const wallet = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'GoPay', exact: true }) });
  await expect(wallet).toContainText('455.000');
  const fund = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'RDN Mandiri Sekuritas', exact: true }) });
  await expect(fund).toContainText('8.000.000');

  // Both are money the owner holds, so net worth counts them and the wallet's spending came off it.
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('8.455.000');

  // A wallet has no day the money comes back: the deposit's terms card belongs to deposits only.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /^GoPay/ }).first().click();
  await expect(page.getByText('Deposit terms')).toHaveCount(0);
});

test('a deposit funded from an account moves the money, and says where it came from', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '100000000' });
  // The question is asked only once there is a figure to ask about, and the account it names is the answer.
  await openAccount(page, { subtype: 'time_deposit', name: 'bluuu', balance: '50000000', from: 'BCA Tahapan', matures: '2026-12-02' });

  // Both balances moved: the bank lost what the deposit holds, and net worth did not gain the money twice.
  const bank = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'BCA Tahapan', exact: true }) });
  await expect(bank).toContainText('50.000.000');
  const deposit = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'bluuu', exact: true }) });
  await expect(deposit).toContainText('50.000.000');
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('100.000.000');

  // And its ledger shows one transfer naming both accounts, not an opening balance.
  await page.goto('/accounts');
  await openTypes(page);
  // The name opens the deposit's own page; its ledger is the row on it that says so.
  await page.getByRole('link', { name: 'bluuu', exact: true }).click();
  await page.getByRole('link', { name: /Its transactions/ }).click();
  const row = page.getByRole('main').getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Transfer');
  await expect(row).toContainText('bluuu');
  await expect(row).toContainText('BCA Tahapan');
  await expect(row).not.toContainText('Opening balance');

  // A deposit keeps its own terms card, with the term beside the rate and date; a wallet has neither.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /^bluuu/ }).first().click();
  await expect(page.getByText('Deposit terms')).toBeVisible();
  await expect(page.getByLabel('Term', { exact: true })).toBeVisible();
});
