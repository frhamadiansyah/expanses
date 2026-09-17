import { expect, test } from '@playwright/test';

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

test('⋯ narrows the list by what paid, and a chip takes it off again', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByTestId('filters-menu').getByRole('menuitem', { name: /Paid with/ }).click();
  await page.getByTestId('paid-with-sheet').getByRole('button', { name: /BCA Tahapan/ }).click();

  const chips = page.getByTestId('active-filters');
  await expect(chips).toContainText('Paid with BCA Tahapan');
  await expect(page.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-pressed', 'true');

  await chips.getByRole('button', { name: 'Clear paid with' }).click();
  await expect(page.getByTestId('active-filters')).toHaveCount(0);
});
