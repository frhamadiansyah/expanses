import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory, pickBillPaidFrom, showRepeating } from './bill-form';
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

/** An every-3-months bill whose first occurrence is on the month and day given. */
async function addEveryThreeMonths(page: Page, name: string, at: { month: number; day: number }) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill('300000');
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Repeats').selectOption({ label: 'Every few months' });
  // The schedule is Months, Starting and Due by: no Bill date, no Month.
  await expect(page.getByLabel('Months', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Bill date')).toHaveCount(0);
  await expect(page.getByLabel('Month', { exact: true })).toHaveCount(0);
  await page.getByLabel('Starting').selectOption(String(at.month));
  await page.getByLabel('Due by').selectOption(String(at.day));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

test('an every-3-months bill 20 days ahead shows under Due soon; its page has History only once paid', async ({ page }) => {
  const at = await daysAhead(page, 20);
  await addEveryThreeMonths(page, 'Water', at);

  const soon = page.locator('section').filter({ has: page.getByText('Due soon', { exact: true }) });
  await expect(soon.getByTestId('bill-row').filter({ hasText: 'Water' })).toBeVisible();

  await row(page, 'Water').click();
  await expect(page.getByRole('heading', { name: 'Water' })).toBeVisible();
  await expect(page.getByText('Every 3 months ·')).toBeVisible();
  // One date: Due by, no Out on. Nothing paid yet, so no History group at all.
  await expect(page.getByText('Due by', { exact: true })).toBeVisible();
  await expect(page.getByText('Out on', { exact: true })).toHaveCount(0);
  await expect(page.getByText('History', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('bill-history')).toHaveCount(0);

  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay' }).click();
  await page.getByRole('dialog', { name: 'Pay Water' }).getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('dialog', { name: 'Pay Water' })).toHaveCount(0);
  await expect(page.getByText('History', { exact: true })).toBeVisible();
  await expect(page.getByTestId('bill-history')).toContainText(`Paid in ${at.iso.slice(0, 4)}`);
});

test('an every-3-months bill far from its date is under Repeating bills, due on its day', async ({ page }) => {
  const at = await daysAhead(page, 75);
  await addEveryThreeMonths(page, 'Rubbish', at);
  await expect(row(page, 'Rubbish')).toHaveCount(0);
  await showRepeating(page);
  const rubbish = page.getByTestId('yearly-bill-row').filter({ hasText: 'Rubbish' });
  await expect(rubbish).toContainText(`Due ${at.day} `);
  await expect(rubbish).toContainText('every 3 months');
});
