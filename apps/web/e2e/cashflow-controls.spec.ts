import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu, startSelecting } from './add-transaction';

/*
 * Cashflow's history header on a wide screen (owner 2026-11-15): the bold "Transactions" title and one ⋯ square whose
 * menu is one group (owner 2026-11-16): Select, Sort (a grey word cycling on each tap), Paid with — a searchable list
 * here — and Reset. A sort or filter on is only a dot.
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
  // Not monthly (owner 2026-11-18), Hidden, a grey word like Sort's; no Transfers, no switch.
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(0);
  await expect(menu.getByTestId('not-monthly-cycle')).toHaveText(/^Not monthly\s*Hidden$/);
  await expect(menu).not.toContainText('Transfers');
  const sort = menu.getByTestId('sort-cycle');
  await expect(sort).toHaveText(/^Sort\s*Newest$/);
  await sort.click();
  await sort.click();
  await expect(sort).toHaveText(/^Sort\s*Largest$/);
  await expect(rows.first()).toContainText('Superindo');
  await expect(page.getByTestId('filter-on')).toBeVisible();

  // Sort leaves the menu open, so Paid with is the next tap.
  await page.getByRole('menuitem', { name: /^Payment method/ }).click();
  await page.getByLabel('Find a payment method').fill('bca');
  await page.getByRole('option', { name: /BCA Tahapan/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');

  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
  await historyMenu(page).click();
  await expect(sort).toHaveText(/^Sort\s*Newest$/);
});

test('Type offers Everything, Spending and Income, and no Transfers & lending', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([/Everything$/, /Spending$/, /Income$/]);
});
