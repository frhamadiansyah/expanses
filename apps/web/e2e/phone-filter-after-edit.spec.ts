import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, saveButton, historyMenu } from './add-transaction';

/*
 * The list's Paid with filter is still on after a row is opened, edited and saved: the list the edit returns to is the
 * filtered one, not the whole month.
 */
test('Paid with stays on after a transaction is edited and saved', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jenius Utama', balance: '3000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '500000' });
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'Jenius Utama', category: 'Groceries', amount: '38000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(2);

  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: /^Payment method/ }).click();
  await page.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: 'Jenius Utama', exact: true }).click();
  await expect(rows).toHaveCount(1);

  await rows.first().click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('form').or(page.getByRole('dialog')).filter({ has: page.getByLabel('Note') }).first();
  await edit.getByLabel('Note').fill('Kopi Kenangan Senopati');
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);

  await expect(page.getByTestId('filter-on')).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan Senopati');
});
