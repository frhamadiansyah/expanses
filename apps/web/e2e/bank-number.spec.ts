import { expect, test } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { addTransaction } from './add-transaction';
import { pasteInto } from './paste';

test('a bank account named by the end of its number shows it on its transactions, and keeps it in Settings', async ({ page }) => {
  await openAccount(page, {
    subtype: 'bank',
    name: 'BCA Tahapan',
    balance: '5000000',
    extra: async (p) => {
      const digits = p.getByLabel('Account number', { exact: true });
      // The number pad's four digits, and nothing past them: a fifth, or a letter, is not taken.
      await expect(digits).toHaveAttribute('inputmode', 'numeric');
      await expect(digits).toHaveAttribute('placeholder', 'Last 4 digits');
      await digits.pressSequentially('12a345');
      await expect(digits).toHaveValue('1234');
      // A whole account number pasted in keeps its last four, not the first four the field's length would keep.
      await digits.fill('');
      await pasteInto(digits, '123-456-4321');
      await expect(digits).toHaveValue('4321');
    },
  });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '85000' });
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('4321');

  await page.goto('/wallet');
  await walletCard(page, 'BCA Tahapan').click();
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Last 4 digits', { exact: true })).toHaveValue('4321');
});
