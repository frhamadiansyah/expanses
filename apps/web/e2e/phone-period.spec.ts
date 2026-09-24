import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';

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

test('the list narrows by what paid, beside the sort, and a chip takes it off again', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  await page.goto('/transactions');
  // The filter is a control of the list itself now: the icon beside the sort it shares a row with, offering only
  // what can pay — the account's own row is a choice, a locked deposit would not be.
  await page.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('option', { name: /BCA Tahapan/ }).click();

  // And ⋯ is left with what only ⋯ can do: the workspace, and what the list reveals.
  await page.getByRole('button', { name: 'Filters' }).click();
  const menu = page.getByTestId('filters-menu');
  await expect(menu).not.toContainText('Paid with');
  await expect(menu).not.toContainText('Not recorded');
  await page.getByRole('button', { name: 'Close filters' }).click();

  const chips = page.getByTestId('active-filters');
  await expect(chips).toContainText('Paid with BCA Tahapan');

  await chips.getByRole('button', { name: 'Clear paid with' }).click();
  await expect(page.getByTestId('active-filters')).toHaveCount(0);
});
