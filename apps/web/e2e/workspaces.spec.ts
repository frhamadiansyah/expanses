import { expect, test } from '@playwright/test';

/**
 * An account is yours, not a workspace's, so its history holds every workspace and each row says which one it
 * belongs to — unless there is only one workspace, when the badge would say the same word on every row.
 */
test('an account’s history opens from Accounts, and badges nothing while there is one workspace', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Supplier dinner');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByLabel('Amount', { exact: true }).fill('640000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Supplier dinner')).toBeVisible();

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'BCA Tahapan', exact: true }).click();
  await expect(page.locator('li', { hasText: 'Supplier dinner' }).first()).toContainText('640.000');
  // One workspace, so no row names it: a badge every row carried would say nothing at all.
  await expect(page.getByTestId('workspace-badge')).toHaveCount(0);
});

// Needs a second workspace, which is made by the workspace sheet's "New workspace" — Task 7. Until that lands
// there is no way to reach two workspaces from the browser, so this flow cannot be driven yet.
test.skip('an account’s history holds every workspace, each row saying which', async ({ page }) => {
  await page.goto('/accounts');
  // Build: a bank account, a card, a second workspace copying categories (through the workspace sheet's
  // New workspace), a purchase in each, then open the card from Accounts.
  await expect(page.getByTestId('workspace-badge').filter({ hasText: 'Business' })).toBeVisible();
  await expect(page.getByTestId('workspace-badge').filter({ hasText: 'Personal' })).toBeVisible();
});
