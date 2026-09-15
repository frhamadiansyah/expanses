import { expect, type Page, test } from '@playwright/test';

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = local(now);
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));

async function setUp(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Statement day').fill('31');
  await page.getByLabel('Payment due day').fill('15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Statements')).toBeVisible();
}

async function buy(page: Page, description: string, amount: string, on: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Date').fill(on);
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Visa (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Add transaction' })).toBeVisible();
}

async function openCard(page: Page) {
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
}

test('a purchase the bank billed a statement late moves to the next one', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openCard(page);

  await expect(page.getByTestId('left-to-pay')).toContainText('2.000.000');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  const hotel = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' });
  await hotel.getByRole('button', { name: 'Billed next statement' }).click();
  await expect(page.getByTestId('statement-line')).toHaveCount(0);
  await expect(page.getByTestId('left-to-pay')).toHaveCount(0);

  await page.getByRole('button', { name: 'Later statement' }).click();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' })).toContainText('Billed late');
});

test('chosen purchases are paid before the statement, and show as paid', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Superindo', '450000', TODAY);
  await buy(page, 'Ranch Market', '80000', TODAY);
  await openCard(page);

  await page.getByLabel('Pay Superindo').check();
  await page.getByLabel('Pay Ranch Market').check();
  await page.getByRole('button', { name: /^Pay Rp/ }).click();

  const lines = page.getByTestId('statement-line');
  await expect(lines.filter({ hasText: 'Superindo' })).toContainText('Paid');
  await expect(lines.filter({ hasText: 'Ranch Market' })).toContainText('Paid');
  await expect(lines.filter({ hasText: 'payment' })).toContainText('530.000');
  await expect(page.getByLabel('Pay Superindo')).toBeDisabled();
});
