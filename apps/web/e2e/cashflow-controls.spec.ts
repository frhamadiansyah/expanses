import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/* Cashflow's controls bar on a wide screen: Select and one Sort and filter button, whose Paid with is a searchable list. */
test('Select and Sort and filter sit in the bar; the menu sorts, filters by Paid with and resets', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jago', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  await addTransaction(page, { description: 'Superindo', paidWith: 'Jago', category: 'Groceries', amount: '500000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(2);

  await expect(page.getByRole('group', { name: 'Group by' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort and filter' })).toHaveCount(1);
  const select = page.getByRole('button', { name: 'Select', exact: true });
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('toolbar', { name: 'Selected transactions' })).toBeVisible();
  await select.click();
  await expect(page.getByRole('toolbar', { name: 'Selected transactions' })).toHaveCount(0);

  const open = () => page.getByRole('button', { name: 'Sort and filter' }).click();
  await open();
  await page.getByRole('menuitemradio', { name: 'Largest first' }).click();
  await expect(rows.first()).toContainText('Superindo');

  await open();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  await page.getByLabel('Find in paid with').fill('bca');
  await page.getByRole('option', { name: /BCA Tahapan/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');

  await open();
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(2);
});
