import { expect, type Page, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // The plan is due from its day in the month: the clock is pinned past the 5th and before the 20th.
  await page.clock.setSystemTime(new Date('2026-10-12T12:00:00+07:00'));
});

/** A monthly plan set in the fund's Settings: its row opens the sheet, which saves with ✓. */
async function setPlan(page: Page, amount: string, day: string) {
  await page.getByTestId('monthly-plan').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Buys', { exact: true })).toBeVisible();
  await sheet.getByLabel('Amount (IDR)').fill(amount);
  await sheet.getByLabel('Every month on').selectOption(day);
  await expect(sheet.getByLabel('Paid from')).toHaveValue(/.+/);
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(sheet).toHaveCount(0);
}

test('a monthly plan set on the holding comes due on Recurring, and Record there buys it and marks it bought', async ({ page }) => {
  await fundByMoney(page);
  // Set once and left, it sits in the holding's Settings rather than on its page.
  await expect(page.getByTestId('monthly-plan')).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('monthly-plan')).toContainText('None');
  await setPlan(page, '500000', '5');
  await expect(page.getByTestId('monthly-plan')).toContainText('Rp 500.000 · 5th');

  await page.goto('/bills');
  const row = page.getByTestId('monthly-buys').getByTestId('plan-row');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-state', 'due');
  await expect(row).toContainText(FUND);
  await expect(row.getByTestId('plan-status')).toHaveText('Due on the 5th · from BCA');
  await expect(row).toContainText('Rp 500.000');

  // Record opens the Buy sheet with the plan's holding, amount and account in it.
  await page.getByRole('button', { name: `Record ${FUND}` }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('What it cost, before fees (IDR)')).toHaveValue(/500\.000/);
  await expect(sheet.getByLabel('Money account')).toContainText('BCA');
  await sheet.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await expect(row).toHaveAttribute('data-state', 'bought');
  await expect(row.getByTestId('plan-status')).toHaveText('Bought · 12 Oct');
  await expect(page.getByRole('button', { name: `Record ${FUND}` })).toHaveCount(0);

  // The row opens the holding, where the buy is in the History and the money in.
  await row.click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 1.500.000');
});

test('a plan whose day is ahead waits quietly; changed and removed from the holding, Recurring follows', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await setPlan(page, '750000', '20');
  await expect(page.getByTestId('monthly-plan')).toContainText('Rp 750.000 · 20th');

  await page.goto('/bills');
  const row = page.getByTestId('plan-row');
  await expect(row).toHaveAttribute('data-state', 'later');
  await expect(row.getByTestId('plan-status')).toHaveText('On the 20th · from BCA');
  await expect(page.getByRole('button', { name: `Record ${FUND}` })).toHaveCount(0);

  // Moved to the 3rd in the holding's Settings, it is due.
  await row.click();
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('monthly-plan').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Amount (IDR)')).toHaveValue(/750\.000/);
  await sheet.getByLabel('Every month on').selectOption('3');
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByTestId('monthly-plan')).toContainText('Rp 750.000 · 3rd');
  await page.goto('/bills');
  await expect(page.getByTestId('plan-row')).toHaveAttribute('data-state', 'due');

  // Removed, it is gone from Recurring.
  await page.getByTestId('plan-row').click();
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByTestId('monthly-plan').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove plan' }).click();
  await expect(page.getByTestId('monthly-plan')).toContainText('None');
  await page.goto('/bills');
  await expect(page.getByTestId('monthly-buys')).toHaveCount(0);
});

test('the old Monthly plans address opens Recurring', async ({ page }) => {
  await page.goto('/net-worth/trades/plans');
  await expect(page).toHaveURL(/\/bills$/);
});
