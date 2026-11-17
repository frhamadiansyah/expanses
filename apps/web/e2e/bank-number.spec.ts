import { expect, test } from '@playwright/test';
import { openAccount, walletCard, openFace } from './accounts';
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
  await openFace(walletCard(page, 'BCA Tahapan'));
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  const number = page.getByLabel('Account number', { exact: true });
  await expect(number).toHaveValue('4321');
  // The whole number can be typed here: the rows keep its last four, and the tax report's own rows do not ask again.
  await number.fill('1234 5678 9012');
  await number.press('Tab');
  await page.waitForTimeout(800);
  await expect(page.getByText('Account holder')).toHaveCount(1);
  await expect(page.getByLabel('Account number', { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Account number', { exact: true })).toHaveValue('1234 5678 9012');
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('9012');
});
