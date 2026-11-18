import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { peekBill, peekButton } from './bills-desk';

/*
 * The wide screen's Overview (Mac Overview A, 2026-11-17): the first page on a wide screen, first in the sidebar, its
 * boxes reading figures the app already has. Invented data.
 */
test.beforeEach(async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('opens first on a wide screen and shows money on hand, the accounts and the boxes', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '90000000' });
  await openAccount(page, { subtype: 'cash', name: 'Dompet', balance: '10000000' });

  await page.goto('/');
  await expect(page).toHaveURL(/\/overview$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.locator('aside nav').getByRole('link').first()).toHaveText('Overview');
  await expect(page.locator('aside nav').getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

  // Money on hand is Wallet's Balance: the two accounts, nothing owed and no bills.
  await expect(page.getByTestId('overview-on-hand')).toHaveText(/100\.000\.000/);

  const accounts = page.getByRole('region', { name: 'Accounts' });
  await expect(accounts).toContainText('2 accounts');
  await expect(accounts.locator('a[href^="/accounts/"]')).toHaveText([/^Bank Satu\s*90 jt/, /^Dompet\s*10 jt/]);

  // Nothing spent yet: Expected has nothing to go on, and How long it lasts has nothing to measure by.
  await expect(page.getByTestId('overview-expected')).toHaveText('Expected: nothing to go on yet');
  await expect(page.getByRole('region', { name: 'How long it lasts' })).toContainText('6 months');

  await expect(page.getByRole('region', { name: 'Worth a look' })).toContainText('Never backed up');
  await expect(page.getByRole('region', { name: 'Next 14 days' })).toContainText('Nothing due in the next 14 days.');

  // The range moves a month at a time.
  const range = page.getByTestId('overview-range');
  const before = await range.innerText();
  await page.getByRole('button', { name: 'Earlier months' }).click();
  await expect(range).not.toHaveText(before);
  await page.getByRole('button', { name: 'Later months' }).click();
  await expect(range).toHaveText(before);

  // A box's title opens its page; ＋ Add opens the Add screen.
  await page.getByRole('region', { name: 'Accounts' }).getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await page.goto('/overview');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page).toHaveURL(/\/transactions\/new$/);
});

test('a month’s figures follow Cashflow’s not-monthly rule: a bill every 6 months makes no spike, and Budget still counts it', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2027-03-05T12:00:00'));
  await openAccount(page, { subtype: 'bank', name: 'Contoh Tabungan', balance: '50000000' });

  // A bill every 6 months out on 5 March, paid from its peek on Mac Bills, and a dinner the day before.
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Life cover premium');
  await page.getByLabel('Amount', { exact: true }).fill('12000000');
  await pickBillCategory(page, 'Life insurance');
  await pickBillPaidFrom(page, 'Contoh Tabungan');
  await page.getByLabel('Repeats').selectOption({ label: 'Every few months' });
  await page.getByLabel('Months', { exact: true }).selectOption('6');
  await page.getByLabel('Starting').selectOption('3');
  await page.getByLabel('Due by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await peekBill(page, 'Life cover premium');
  await peekButton(page, 'Pay').click();
  await page.getByRole('dialog', { name: 'Pay Life cover premium' }).getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('dialog', { name: 'Pay Life cover premium' })).toHaveCount(0);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Contoh', paidWith: 'Contoh Tabungan', category: 'Restaurants', amount: '286000', date: '2027-03-04' });

  // Cashflow's March, and Overview's March bar: the dinner alone — the two tie out.
  await expect(page.getByTestId('month-spent')).toHaveText(/^Rp\s286\.000$/);
  await page.goto('/overview');
  const chart = page.getByRole('region', { name: 'Money on hand' });
  await expect(chart.locator('title', { hasText: 'March 2027: spent' })).toHaveText(/^March 2027: spent Rp\s286\.000$/);
  // Budget is as it was: the month spent the bill too.
  await page.goto('/budget');
  await expect(page.locator('body')).toContainText(/Not budgeted\s*Rp\s12\.286\.000/);

  // A month on, Spent a month (the last three full months) is the dinner's third, not the bill's.
  await page.clock.setSystemTime(new Date('2027-04-10T12:00:00'));
  await page.goto('/overview');
  const lasts = page.getByRole('region', { name: 'How long it lasts' });
  await expect(lasts).toContainText(/Spent a month\s*Rp\s?95\.333/);

  // Not monthly Shown on Cashflow counts it there, and here too.
  await page.evaluate(() => localStorage.setItem('expanses.cashflow.not-monthly', '1'));
  await page.reload();
  await expect(lasts).toContainText(/Spent a month\s*4,1\s?jt/);
  await expect(chart.locator('title', { hasText: 'March 2027: spent' })).toHaveText(/^March 2027: spent Rp\s12\.286\.000$/);
});
