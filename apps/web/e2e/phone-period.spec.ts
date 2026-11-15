import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the period is chosen from the chart, and its arrows step by that period', async ({ page }) => {
  await page.goto('/transactions');
  const chartMonth = page.getByTestId('chart-month');
  await expect(chartMonth).toBeVisible();

  // A quarter, two taps away from any month.
  await chartMonth.click();
  const picker = page.getByTestId('period-picker');
  await picker.getByRole('tab', { name: 'Quarter' }).click();
  await picker.getByRole('button', { name: 'Earlier' }).click();
  await picker.getByRole('button', { name: /^Q2/ }).click();
  const lastYear = String(new Date().getFullYear() - 1);
  await expect(chartMonth).toHaveText(new RegExp(`Q2 ${lastYear}`));

  // The arrows now move a quarter at a time.
  await page.getByRole('button', { name: 'Later period' }).click();
  await expect(chartMonth).toHaveText(new RegExp(`Q3 ${lastYear}`));

  // All time has nothing either side of it.
  await chartMonth.click();
  await page.getByTestId('period-picker').getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: 'Show all time' }).click();
  await expect(chartMonth).toHaveText(/All time/);
  await expect(page.getByRole('button', { name: 'Earlier period' })).toHaveCount(0);
});

test('the list narrows by what paid, beside the sort, and the menu takes it off again', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  await page.goto('/transactions');
  // Cashflow lists spending and income, not an opening balance, and the controls come with the first row.
  await addTransaction(page, { description: 'Lunch', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '30000' });
  // The filter is a control of the list itself now: the icon beside the sort it shares a row with, offering only
  // what can pay — the account's own row is a choice, a locked deposit would not be.
  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /BCA Tahapan/ }).click();

  // The sort and filter menu closes once a choice is made.
  await expect(page.getByTestId('sort-filter-menu')).toHaveCount(0);

  // A phone has no row of chips: the button wears a dot while a filter is on, and the menu names it and resets it.
  await expect(page.getByTestId('filter-on')).toBeVisible();
  await expect(page.getByText('Lunch')).toBeVisible();
  await historyMenu(page).click();
  await expect(page.getByRole('menuitem', { name: /^Paid with/ })).toContainText('BCA Tahapan');
  await page.getByRole('menuitem', { name: 'Reset' }).click();
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
});
