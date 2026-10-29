import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * Cashflow's controls bar on a phone: the grouping switch, Select and one Sort and filter button, in the grey capsules
 * the app already draws. Select moved here from the ⋯ menu and Lend & borrow to the Account page; ⋯ keeps the workspace.
 */
test('the bar has Days/Categories, Select and one Sort and filter button; the menu sorts, filters and resets', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jago', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  await addTransaction(page, { description: 'Superindo', paidWith: 'Jago', category: 'Groceries', amount: '500000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(2);

  await expect(page.getByRole('group', { name: 'Group by' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort and filter' })).toHaveCount(1);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);

  const open = () => page.getByRole('button', { name: 'Sort and filter' }).click();
  await open();
  const menu = page.getByTestId('sort-filter-menu');
  await expect(menu.getByRole('menuitemradio', { name: 'Newest first' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Reset' })).toBeDisabled();
  await menu.getByRole('menuitemradio', { name: 'Largest first' }).click();
  await expect(rows.first()).toContainText('Superindo');
  await expect(page.getByTestId('filter-on')).toBeVisible();

  await open();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /^BCA Tahapan/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');

  await open();
  await expect(page.getByTestId('sort-filter-menu').getByRole('menuitem', { name: /^Paid with/ })).toContainText('BCA Tahapan');
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
});

test('Select toggles select mode, and its actions stay in the select bar as before', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  const select = page.getByRole('button', { name: 'Select', exact: true });
  const bar = page.getByRole('toolbar', { name: 'Selected transactions' });
  await expect(select).toHaveAttribute('aria-pressed', 'false');
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(bar).toBeVisible();
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'false');
  await expect(bar).toHaveCount(0);
});

test('Lend & borrow is on the Account page, and the Cashflow corner is the workspace', async ({ page }) => {
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Workspace, Personal/ })).toBeVisible();

  await page.goto('/account');
  await page.getByRole('link', { name: /^Lend & borrow/ }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();
});
