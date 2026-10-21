import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

test('a bank account named by the end of its number shows it on its transactions, and keeps it in Settings', async ({ page }) => {
  await openAccount(page, {
    subtype: 'bank',
    name: 'BCA Tahapan',
    balance: '5000000',
    extra: async (p) => {
      await p.getByLabel('Last 4 digits of account number').fill('123-456-4321');
    },
  });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '85000' });
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('4321');

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'BCA Tahapan', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Last 4 digits of account number')).toHaveValue('4321');
});
