import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu, startSelecting } from './add-transaction';

/*
 * Cashflow's history header on a phone (owner 2026-11-15): a bold "Transactions" title, the grey Days | Categories box,
 * and one grey ⋯ square whose menu is one group (owner 2026-11-16): Select, Sort (a grey word that cycles on each tap),
 * Paid with and Reset. A sort or filter on is only a dot.
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
  // Every item, in order, one group with no headings: Select, Sort, Paid with, Not monthly (owner 2026-11-18), Reset.
  await expect(menu.getByRole('menuitem').or(menu.getByRole('menuitemradio')).or(menu.getByRole('menuitemcheckbox'))).toHaveText([
    'Select',
    /^Sort\s*Newest$/,
    /^Payment method\s*All$/,
    /^Not monthly\s*Hidden$/,
    'Reset',
  ]);
  await expect(menu.getByText('Show', { exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Reset' })).toBeDisabled();
  // Sort's order is a plain grey word, like Paid with's All: no icon, not blue.
  const sort = menu.getByTestId('sort-cycle');
  const word = sort.locator('span').last();
  await expect(sort.locator('svg')).toHaveCount(0);
  await expect(word).toHaveCSS('color', await menu.getByRole('menuitem', { name: /^Payment method/ }).locator('span').nth(1).evaluate((el) => getComputedStyle(el).color));
  // Each tap is the next order, the menu left open: Newest → Oldest → Largest.
  await sort.click();
  await expect(sort).toHaveText(/^Sort\s*Oldest$/);
  await sort.click();
  await expect(sort).toHaveText(/^Sort\s*Largest$/);
  await expect(rows.first()).toContainText('Superindo');
  // A sort off its rest: a dot on ⋯, the square itself stays grey, and no chip.
  await expect(page.getByTestId('filter-on')).toBeVisible();
  await expect(page.getByTestId('filter-on')).toHaveCSS('background-color', 'rgb(0, 122, 255)');
  await expect(historyMenu(page)).not.toHaveClass(/bg-slate-900/);
  // Two more: Smallest, then round to Newest.
  await sort.click();
  await expect(sort).toHaveText(/^Sort\s*Smallest$/);
  await sort.click();
  await expect(sort).toHaveText(/^Sort\s*Newest$/);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
  await sort.click();
  await sort.click();
  await expect(sort).toHaveText(/^Sort\s*Largest$/);

  await page.getByRole('menuitem', { name: /^Payment method/ }).click();
  await page.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: /^BCA Tahapan/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');

  // Reset puts Sort back to Newest and Paid with back to All.
  await historyMenu(page).click();
  await expect(sort).toHaveText(/^Sort\s*Largest$/);
  await expect(menu.getByRole('menuitem', { name: /^Payment method/ })).toContainText('BCA Tahapan');
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
  await historyMenu(page).click();
  await expect(sort).toHaveText(/^Sort\s*Newest$/);
  await expect(menu.getByRole('menuitem', { name: /^Payment method/ })).toHaveText(/^Payment method\s*All$/);
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
