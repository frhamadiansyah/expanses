import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { workspaceLine } from './workspace-page';

/*
 * Deleting a workspace, written once for both shapes (workspace-delete.spec.ts and phone-workspace-delete.spec.ts run
 * the same walks). Every walk starts and ends on the Account page, which both shapes have.
 */

/** Makes a workspace from the Account page's sheet, copying Personal's categories when asked. */
export async function makeWorkspace(page: Page, name: string, copyPersonal: boolean) {
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  if (copyPersonal) await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/account');
}

export async function openPage(page: Page, name: string) {
  await page.goto('/account');
  await workspaceLine(page, name).getByTestId('workspace-open').click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** An empty workspace asks once ("Click again to delete") and is gone from the list and from the archived one. */
export async function deleteEmpty(page: Page) {
  await makeWorkspace(page, 'Warung', false);
  await expect(page.getByTestId('account-workspace')).toHaveCount(2);
  await openPage(page, 'Warung');
  const del = page.getByTestId('delete-workspace');
  await expect(del).toHaveText('Delete');
  await del.click();
  await expect(del).toHaveText('Click again to delete');
  await del.click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-workspace')).toHaveCount(1);
  await expect(page.getByTestId('archived-workspace')).toHaveCount(0);
  await expect(page.getByText('Warung')).toHaveCount(0);
}

/** One holding a transaction asks for its name: the button is disabled until it matches, and everything goes. */
export async function deleteWithTransactions(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await makeWorkspace(page, 'Business', true);
  // Open in it, so the dinner is filed there.
  await workspaceLine(page, 'Business').getByTestId('workspace-switch').click();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Supplier dinner', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '640000' });
  await expect(page.getByText('Supplier dinner')).toBeVisible();

  await openPage(page, 'Business');
  await page.getByTestId('delete-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'Delete workspace' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Transactions');
  await expect(sheet.getByText('1', { exact: true })).toBeVisible();
  const everything = sheet.getByTestId('delete-everything');
  await expect(everything).toBeDisabled();
  await sheet.getByLabel('Name', { exact: true }).fill('Busines');
  await expect(everything).toBeDisabled();
  await sheet.getByLabel('Name', { exact: true }).fill('  bUSINESS ');
  await expect(everything).toBeEnabled();
  await everything.click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-workspace')).toHaveCount(1);
  await expect(page.getByTestId('archived-workspace')).toHaveCount(0);
  await expect(page.getByText('Business')).toHaveCount(0);
  // The open workspace fell back to Personal, and the dinner is gone from the books.
  await page.goto('/transactions');
  await expect(page.getByText('Supplier dinner')).toHaveCount(0);
}

/** Personal cannot be deleted; the page says so in the place it was asked to go. */
export async function refusePersonal(page: Page) {
  await openPage(page, 'Personal');
  await page.getByTestId('delete-workspace').click();
  await expect(page.getByRole('alert')).toContainText('Personal is where categories and expected income fall back to, so it cannot be deleted');
  await page.goto('/account');
  await expect(page.getByTestId('account-workspace')).toHaveCount(1);
}

/** Archive and Restore still work from the same box. */
export async function archiveAndRestore(page: Page) {
  await makeWorkspace(page, 'Kiosk', false);
  await openPage(page, 'Kiosk');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to archive' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('archived-workspace')).toHaveCount(1);
  await page.getByTestId('archived-workspace').click();
  await expect(page.getByTestId('delete-workspace')).toBeVisible();
  await page.getByTestId('restore-workspace').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('archived-workspace')).toHaveCount(0);
  await expect(page.getByTestId('account-workspace')).toHaveCount(2);
}
