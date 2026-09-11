import { expect, test } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Superindo');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Visa (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill('500000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Superindo')).toBeVisible();

  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.getByLabel('From').selectOption({ label: 'BCA Checking (IDR)' });
  await page.getByLabel('To', { exact: true }).selectOption({ label: 'BCA Visa (IDR)' });
  await page.getByLabel('Amount', { exact: true }).fill('500000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Transfer', { exact: true }).first()).toBeVisible();

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('500.000');

  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('19.500.000');
});
