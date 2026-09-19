import { expect, test } from '@playwright/test';

/**
 * The receipt, reached the way a desktop reaches it: the ⓘ at the end of the row.
 *
 * Task 17 grows this file into the full desktop pass. It exists from here so that task modifies a file that is
 * already there, rather than inventing one beside it.
 */
test('the ⓘ on a row opens the receipt, and the row itself still edits in place', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Superindo');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Visa (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill('500000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Superindo')).toBeVisible();

  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();

  // Its own route, so it can be linked to, bookmarked and reached by URL — not a panel on the list.
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  await expect(page.getByRole('heading', { name: 'Superindo' })).toBeVisible();

  // The figure, not the word: what the card was charged, beside the account that was charged.
  const paidWith = page.locator('div', { hasText: /^Paid with/ }).last();
  await expect(paidWith).toContainText('BCA Visa');
  const total = page.locator('div', { hasText: /^Total/ }).last();
  await expect(total).toContainText('500.000');
  await expect(page.getByTestId('receipt-hero')).toContainText('500.000');

  // Back lands where it came from, and the row's own click still opens the in-place editor: the ⓘ is a way in
  // beside editing, never instead of it.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await page.locator('li', { hasText: 'Superindo' }).click();
  await expect(page.getByLabel('Row description')).toHaveValue('Superindo');
});
