import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu, startSelecting } from './add-transaction';

/*
 * Cashflow's history header on a phone (owner 2026-11-15): a bold "Transactions" title, the grey Days | Categories box,
 * and one grey ⋯ square whose menu holds Select, the sorts, Paid with and Transfers. A sort or filter on is only a dot.
 * Lend & borrow is on the Account page; the corner keeps the workspace.
 */
test('the header has Transactions, Days/Categories and one ⋯; its menu selects, sorts, filters and resets', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jago', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  await addTransaction(page, { description: 'Superindo', paidWith: 'Jago', category: 'Groceries', amount: '500000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(2);

  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Group by' })).toBeVisible();
  // Select and Sort are no longer squares of their own.
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sort and filter' })).toHaveCount(0);
  await expect(historyMenu(page)).toHaveCount(1);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);

  await historyMenu(page).click();
  const menu = page.getByTestId('sort-filter-menu');
  // Every item, in order: Select, then Sort, then Show.
  await expect(menu.getByRole('menuitem').or(menu.getByRole('menuitemradio')).or(menu.getByRole('menuitemcheckbox'))).toHaveText([
    'Select',
    'Newest first',
    'Oldest first',
    'Largest first',
    'Smallest first',
    /^Paid with\s*All$/,
    'Transfers',
    'Reset',
  ]);
  await expect(menu.getByText('Sort', { exact: true })).toBeVisible();
  await expect(menu.getByText('Show', { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: 'Newest first' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Reset' })).toBeDisabled();
  await menu.getByRole('menuitemradio', { name: 'Largest first' }).click();
  await expect(rows.first()).toContainText('Superindo');
  // A sort off its rest: a dot on ⋯, the square itself stays grey, and no chip.
  await expect(page.getByTestId('filter-on')).toBeVisible();
  await expect(page.getByTestId('filter-on')).toHaveCSS('background-color', 'rgb(0, 122, 255)');
  await expect(historyMenu(page)).not.toHaveClass(/bg-slate-900/);

  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /^BCA Tahapan/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');

  await historyMenu(page).click();
  await expect(menu.getByRole('menuitemradio', { name: 'Largest first' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: /^Paid with/ })).toContainText('BCA Tahapan');
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);

  // Transfers alone puts the dot on too, and taking it off takes the dot away.
  await historyMenu(page).click();
  await menu.getByRole('menuitemcheckbox', { name: 'Transfers' }).click();
  await expect(page.getByTestId('filter-on')).toBeVisible();
  await historyMenu(page).click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Transfers' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemcheckbox', { name: 'Transfers' }).click();
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
});

test('Select from the ⋯ menu turns ⋯ into the dark Select square, which stops selecting', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  const bar = page.getByRole('toolbar', { name: 'Selected transactions' });
  await startSelecting(page);
  await expect(page.getByRole('checkbox', { name: 'Select Kopi Kenangan' })).toBeVisible();
  await expect(historyMenu(page)).toHaveCount(0);
  const stop = page.getByRole('button', { name: 'Select', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(stop).toHaveClass(/bg-slate-900/);
  await stop.click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Kopi Kenangan' })).toHaveCount(0);
  await expect(stop).toHaveCount(0);
  await expect(historyMenu(page)).toBeVisible();
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
