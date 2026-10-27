import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory } from './bill-form';
import { localIsoDate, todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const row = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

/** A date this many days from the browser's today. */
async function daysAhead(page: Page, days: number) {
  const [y, m, d] = (await todayIn(page)).split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + days);
  return { month: date.getMonth() + 1, day: date.getDate(), iso: localIsoDate(date) };
}

/** A yearly bill that comes out on the month and day given. */
async function addYearlyBill(page: Page, name: string, at: { month: number; day: number }) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill('3000000');
  await pickBillCategory(page);
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption(String(at.month));
  await page.getByLabel('Due by').selectOption(String(at.day));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

test('on a phone, a yearly bill far from its date is under Repeating bills', async ({ page }) => {
  const at = await daysAhead(page, 180);
  await addYearlyBill(page, 'Domain', at);

  // Nothing is owed: no row, no total, and the Cashflow card has no bill to count.
  await expect(row(page, 'Domain')).toHaveCount(0);
  await expect(page.getByTestId('bills-total')).toHaveCount(0);
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toHaveCount(0);

  await page.goto('/bills');
  await expect(page.getByTestId('yearly-bills-row')).toContainText('1');
  await page.getByTestId('yearly-bills-row').click();
  const yearly = page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' });
  await expect(yearly).toContainText('3.000.000');
  await yearly.click();
  await expect(page.getByRole('heading', { name: 'Domain' })).toBeVisible();
  await expect(page.getByText('Every year ·')).toBeVisible();
});

test('on a phone, a yearly bill 20 days ahead is on Recurring under Due soon', async ({ page }) => {
  const at = await daysAhead(page, 20);
  await addYearlyBill(page, 'Car tax', at);
  const soon = page.locator('section').filter({ has: page.getByText('Due soon', { exact: true }) });
  await expect(soon.getByTestId('bill-row').filter({ hasText: 'Car tax' })).toBeVisible();
});
