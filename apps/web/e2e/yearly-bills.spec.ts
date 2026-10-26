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
  await page.getByLabel('Bill date').selectOption(String(at.day));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

test('a yearly bill 20 days ahead shows under Due soon, and paying it takes it off the list', async ({ page }) => {
  const at = await daysAhead(page, 20);
  await addYearlyBill(page, 'Car tax', at);

  const soon = page.locator('section').filter({ has: page.getByText('Due soon', { exact: true }) });
  await expect(soon.getByTestId('bill-row').filter({ hasText: 'Car tax' })).toBeVisible();
  await expect(page.getByTestId('bills-total')).toContainText('3.000.000');

  await row(page, 'Car tax').hover();
  await page.getByRole('button', { name: 'Actions for Car tax' }).click();
  await page.getByRole('menuitem', { name: /^Pay/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay Car tax' });
  // The year is named, since the other eleven months are not bills.
  await expect(sheet.getByLabel('For')).toContainText(String(at.iso.slice(0, 4)));
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toHaveCount(0);

  // Paid, it leaves Recurring; the Yearly bills page still has it, next date a year on.
  await expect(row(page, 'Car tax')).toHaveCount(0);
  await page.getByTestId('yearly-bills-row').click();
  await expect(page).toHaveURL(/\/bills\/yearly/);
  const next = String(Number(at.iso.slice(0, 4)) + 1);
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Car tax' })).toContainText(`next ${Number(at.iso.slice(8))} `);
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Car tax' })).toContainText(next);

  // Its page reads the repeat and the history by year.
  await page.getByTestId('yearly-bill-row').click();
  await expect(page.getByText('Every year ·')).toBeVisible();
  await expect(page.getByTestId('bill-history')).toContainText(`Paid in ${at.iso.slice(0, 4)}`);
});

test('a yearly bill far from its date is not on Recurring, but is under Yearly bills', async ({ page }) => {
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

test('a bill switches between monthly and yearly in Edit', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Gym');
  await page.getByLabel('Amount', { exact: true }).fill('350000');
  await pickBillCategory(page);
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  // A monthly bill has no Month row.
  await expect(page.getByLabel('Repeats')).toHaveValue('monthly');
  await expect(page.getByLabel('Month', { exact: true })).toHaveCount(0);
  await page.getByLabel('Bill date').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(row(page, 'Gym')).toBeVisible();

  // To yearly, in a month 180 days away: the month is required, then the bill leaves the list.
  const far = await daysAhead(page, 180);
  await row(page, 'Gym').click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Choose the month')).toBeVisible();
  await page.getByLabel('Month', { exact: true }).selectOption(String(far.month));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  await expect(page.getByText('Every year ·')).toBeVisible();
  await page.goto('/bills');
  await expect(row(page, 'Gym')).toHaveCount(0);

  // And back: Edit loads it as yearly, switching to monthly puts it on the list again.
  await page.getByTestId('yearly-bills-row').click();
  await page.getByTestId('yearly-bill-row').click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Repeats')).toHaveValue('yearly');
  await expect(page.getByLabel('Month', { exact: true })).toHaveValue(String(far.month));
  await page.getByLabel('Repeats').selectOption('monthly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  await expect(page.getByText('Every month')).toBeVisible();
  await page.goto('/bills');
  await expect(row(page, 'Gym')).toBeVisible();
});
