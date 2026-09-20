import { expect, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

test('card purchase counts once as spending; statement payment is a transfer', async ({ page }) => {
  await page.goto('/accounts');

  await page.getByLabel('Name', { exact: true }).fill('BCA Checking');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Checking' })).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa' })).toBeVisible();

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
