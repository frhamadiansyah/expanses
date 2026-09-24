import { expect, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { addTransaction } from './add-transaction';

test('a digital wallet and a fund account hold money, and only the wallet is spending money', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '500000' });
  await openAccount(page, { subtype: 'fund', name: 'RDN Mandiri Sekuritas', balance: '8000000' });

  // The broker's cash is a row on no money list: an RDN cannot be paid from, so the list the ledger pays out of
  // does not carry it. It is priced on the asset list — which is where the helper above left us — and named on the
  // tile as money that is parked rather than spendable.
  const broker = page.getByRole('link', { name: /^RDN Mandiri Sekuritas/ });
  await expect(broker).toContainText('8.000.000');
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'RDN Mandiri Sekuritas', exact: true })).toHaveCount(0);
  await expect(page.getByText('Parked at brokers')).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Tegal', paidWith: 'GoPay', category: 'Groceries', amount: '45000' });
  await expect(page.getByText('Warung Tegal')).toBeVisible();

  await page.goto('/accounts');
  await openTypes(page);
  const wallet = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'GoPay', exact: true }) });
  await expect(wallet).toContainText('455.000');

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
  // Both rows are on the asset list, where a row's own name carries its figure — "BCA Tahapan · Ledger balance ·
  // 0102 · … Rp 50.000.000" — so the name is a prefix and the figure is read off the row.
  await expect(page.getByRole('link', { name: /^BCA Tahapan/ })).toContainText('50.000.000');
  await expect(page.getByRole('link', { name: /^bluuu/ })).toContainText('50.000.000');
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('100.000.000');

  // And its ledger shows one transfer naming both accounts, not an opening balance.
  // A deposit is a row on the asset list, not on Accounts: it holds money it cannot be paid from.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /^bluuu/ }).click();
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
