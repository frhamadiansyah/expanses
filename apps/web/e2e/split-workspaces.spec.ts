import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { choosePayment } from './add-transaction';
import { openSplit, pickPartCategory } from './split-row';

/** Makes a workspace through the sidebar switcher and lands in it, as the sheet does on its own. */
async function newWorkspace(page: Page, name: string, startsWith: string) {
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Starts with').selectOption({ label: startsWith });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

async function openWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

/**
 * One purchase split across two workspaces (0084): one charge on the account, Rp 900.000 of groceries for Personal and
 * Rp 450.000 of restaurants for Business. Each Cashflow lists it once, at its own part, marked as split; the receipt
 * shows the whole charge and every part with its workspace. Invented figures.
 */
test('a purchase split across workspaces lists each part in its workspace, and the receipt shows the whole', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await newWorkspace(page, 'Business', 'Copy from Personal');
  await openWorkspace(page, 'Personal');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByLabel('Note').fill('Pasar Sentosa');
  await openSplit(page);
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await pickPartCategory(page, 1, 'Groceries');
  await split.getByLabel('Split 1 amount').fill('900000');
  // Business's categories come after this workspace's own, under its name; the line then wears its letter.
  await pickPartCategory(page, 2, 'Restaurants', 'Business');
  await split.getByLabel('Split 2 amount').fill('450000');
  for (const [n, name] of [[0, 'Personal'], [1, 'Business']] as const) {
    const part = split.getByTestId('split-row').nth(n);
    await expect(part.getByTestId('workspace-badge')).toHaveAttribute('title', name);
    await expect(part.getByTestId('split-part-category')).toContainText(name);
  }
  await split.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // Personal: one row, its own part, marked as split.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Pasar Sentosa' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Groceries');
  await expect(row).not.toContainText('Restaurants');
  await expect(row).toContainText('900.000');
  await expect(row).toContainText('⑂ split');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 900.000');

  // The receipt: the whole charge, and each part with its workspace.
  await page.getByRole('link', { name: 'Receipt for Pasar Sentosa' }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('1.350.000');
  await expect(page.getByText('Charged on BCA Tahapan')).toBeVisible();
  const parts = page.getByTestId('split-part');
  await expect(parts).toHaveCount(2);
  await expect(parts.nth(0)).toContainText('Groceries');
  await expect(parts.nth(0)).toContainText('Personal');
  await expect(parts.nth(0)).toContainText('900.000');
  await expect(parts.nth(1)).toContainText('Restaurants');
  await expect(parts.nth(1)).toContainText('Business');
  await expect(parts.nth(1)).toContainText('450.000');
  await expect(parts.nth(1).getByTestId('workspace-badge')).toHaveAttribute('title', 'Business');

  // Business: the same purchase, once, at its part.
  await openWorkspace(page, 'Business');
  await page.goto('/transactions');
  const theirs = page.getByTestId('transaction-row').filter({ hasText: 'Pasar Sentosa' });
  await expect(theirs).toHaveCount(1);
  await expect(theirs).toContainText('Restaurants');
  await expect(theirs).toContainText('450.000');
  await expect(theirs).toContainText('⑂ split');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 450.000');
});
