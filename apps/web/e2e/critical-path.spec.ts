import { expect, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';

test('card purchase counts once as spending; statement payment is a transfer', async ({ page }) => {
  await page.goto('/accounts');

  await openAccount(page, { subtype: 'bank', name: 'BCA Checking', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Visa', category: 'Groceries', amount: '500000' });
  await expect(page.getByText('Superindo')).toBeVisible();

  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'BCA Checking', exact: true }).click();
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'BCA Visa (IDR)' });
  await form.getByLabel('Amount', { exact: true }).fill('500000');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Transfer', { exact: true }).first()).toBeVisible();

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('500.000');

  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('19.500.000');
});
