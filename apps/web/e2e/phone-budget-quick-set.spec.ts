import { addMonths, isoDate, monthOf } from '@expanses/core';
import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { capField } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('by thumb: an uncapped sub-category sits under its parent with Set, and its sheet opens ready to type', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Ride home', paidWith: 'Bank Sample', category: 'Ride hailing', amount: '64000' });

  await page.goto('/budget');
  await expect(page.getByTestId('uncapped-Transportation')).toBeVisible();
  const child = page.getByTestId('uncapped-Ride hailing');
  await expect(child).toContainText('64.000 spent this month');
  await child.tap();
  await expect(page.getByRole('dialog', { name: 'Ride hailing' }).getByLabel('Cap', { exact: true })).toBeFocused();
});

test('by thumb: Fill empty from last month fills a sub-category that spent, and leaves its parent alone', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  const lastMonth = `${addMonths(monthOf(isoDate()), -1)}-10`;
  await addTransaction(page, { description: 'Ride home', paidWith: 'Bank Sample', category: 'Ride hailing', amount: '64000', date: lastMonth });

  await page.goto('/budget');
  await page.getByRole('button', { name: 'Edit budgets', exact: true }).tap();
  const screen = page.getByTestId('edit-budgets');
  await screen.getByRole('button', { name: 'Fill empty from last month' }).tap();
  await expect((await capField(screen, 'Ride hailing')).field).toHaveValue('64.000');
  await expect(screen.getByLabel('All Transportation', { exact: true })).toHaveValue('');
});
