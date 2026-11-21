import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * Cashflow's title bar on a wide screen (Mac Cashflow D, 2026-11-17): Show (All · Spending · Income), Filter ⌄ — the
 * category, what paid, deleted rows — and Clear, and the table's own Date and Amount headers to sort by. The phone's
 * history header (one ⋯ for Select, Sort, Paid with and Reset) is the phone's (`phone-cashflow-controls.spec.ts`), and an
 * account's own history keeps it on a wide screen too.
 */
test('Show, Filter and the Amount header narrow and sort the table, and Clear puts it back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jago', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  await addTransaction(page, { description: 'Superindo', paidWith: 'Jago', category: 'Groceries', amount: '500000' });
  await addTransaction(page, { mode: 'Income', description: 'Salary', paidWith: 'BCA Tahapan', category: 'Salary, wage, or pay', amount: '7500000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(3);

  // Show: one side of the ledger at a time, and the ring follows it.
  const show = page.getByRole('group', { name: 'Show' });
  await expect(show.getByRole('button')).toHaveText(['All', 'Spending', 'Income']);
  await show.getByRole('button', { name: 'Income' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Salary');
  await expect(page.getByRole('region', { name: 'Income by category' })).toBeVisible();
  await show.getByRole('button', { name: 'Spending' }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Spending by category' })).toBeVisible();
  await show.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(3);

  // The Amount header sorts largest first, then smallest; Clear puts it back to oldest at the top.
  await page.getByRole('button', { name: /^Amount/ }).click();
  await expect(rows.first()).toContainText('Salary');
  await page.getByRole('button', { name: /^Amount/ }).click();
  await expect(rows.first()).toContainText('Kopi Kenangan');

  // Filter ⌄: what paid, found by typing; the button counts what is on.
  await page.getByRole('button', { name: /^Filter/ }).click();
  const menu = page.getByRole('dialog', { name: 'Filter' });
  await menu.getByLabel('Find a category or account').fill('jago');
  await menu.getByRole('group', { name: 'Payment method' }).getByRole('button', { name: /Jago/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Superindo');
  await expect(page.getByRole('button', { name: /^Filter · 1/ })).toBeVisible();

  await menu.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(3);
  // Oldest at the top, the row added last at the bottom, just above the typing row.
  await expect(rows.first()).toContainText('Kopi Kenangan');
  await expect(rows.last()).toContainText('Salary');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
});

test('Show deleted is in Filter, and a deleted row comes back struck through', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Kopi Kenangan' });
  await row.click();
  await page.getByTestId('cashflow-peek').getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByTestId('cashflow-peek').getByRole('button', { name: 'Click again to delete' }).click();
  await expect(row).toHaveCount(0);

  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByLabel('Show deleted').check();
  await expect(row).toHaveCount(1);
  await expect(row).toHaveCSS('opacity', '0.5');
});
