import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu, startSelecting } from './add-transaction';

/*
 * Cashflow's history header on a wide screen (owner 2026-11-15): the bold "Transactions" title and one ⋯ square whose
 * menu holds Select, the sorts and Show, where Paid with is a searchable list. A sort or filter on is only a dot.
 */
test('one ⋯ in the header selects, sorts, filters by Paid with and resets, with a dot while anything is on', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jago', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  await addTransaction(page, { description: 'Superindo', paidWith: 'Jago', category: 'Groceries', amount: '500000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(2);

  const title = page.getByRole('heading', { name: 'Transactions', exact: true });
  await expect(title).toHaveCSS('font-size', '18px');
  await expect(title).toHaveCSS('font-weight', '700');
  await expect(page.getByRole('group', { name: 'Group by' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort and filter' })).toHaveCount(0);
  await expect(historyMenu(page)).toHaveCount(1);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);

  // Select from the menu; the dark square in ⋯'s place stops it, and ⋯ comes back.
  await startSelecting(page);
  const stop = page.getByRole('button', { name: 'Select', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(historyMenu(page)).toHaveCount(0);
  await stop.click();
  await expect(page.getByRole('toolbar', { name: 'Selected transactions' })).toHaveCount(0);
  await expect(historyMenu(page)).toBeVisible();

  const menu = page.getByTestId('sort-filter-menu');
  await historyMenu(page).click();
  await expect(menu.getByRole('menuitem', { name: 'Select', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Transfers' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Largest first' }).click();
  await expect(rows.first()).toContainText('Superindo');
  await expect(page.getByTestId('filter-on')).toBeVisible();

  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  await page.getByLabel('Find in paid with').fill('bca');
  await page.getByRole('option', { name: /BCA Tahapan/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');

  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
});
