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
  // Saving terms moves the page on to setting up rewards; the statement is one tab away.
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('tab', { name: 'Statement' }).click();
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

  await expect(page.getByTestId('tile-left-to-pay')).toContainText('2.000.000');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  const hotel = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' });
  await hotel.getByRole('button', { name: 'Billed next statement' }).click();
  await expect(page.getByTestId('statement-line')).toHaveCount(0);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Nothing billed');

  await page.getByRole('button', { name: 'Later statement' }).click();
  // It sits on the later statement now, with the way back beside it.
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' }).getByRole('button', { name: 'Use purchase date' })).toBeVisible();
});

test('chosen purchases are paid before the statement, and show as paid', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Superindo', '450000', TODAY);
  await buy(page, 'Ranch Market', '80000', TODAY);
  await openCard(page);

  await page.getByLabel('Pay Superindo').check();
  await page.getByLabel('Pay Ranch Market').check();
  await page.getByRole('button', { name: /^Pay Rp/ }).click();

  // Paid purchases stay ticked, and can no longer be unticked.
  const lines = page.getByTestId('statement-line');
  const superindo = page.getByLabel(/^Superindo, paid on/);
  await expect(superindo).toBeChecked();
  await expect(superindo).toBeDisabled();
  await expect(page.getByLabel(/^Ranch Market, paid on/)).toBeChecked();
  await expect(lines.filter({ hasText: 'payment' })).toContainText('530.000');

  // Deleting the payment frees them to be paid again.
  await page.goto('/transactions');
  await page.locator('li', { hasText: /BCA Visa payment/ }).first().click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  // Wait for the delete to land: the open form hides the row's text before anything is saved.
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await expect(page.locator('li', { hasText: /BCA Visa payment/ })).toHaveCount(0);
  await openCard(page);
  await expect(page.getByLabel('Pay Superindo')).toBeEnabled();
  await expect(page.getByLabel('Pay Superindo')).not.toBeChecked();
});

test('the last statement is paid from the card’s Left to pay tile', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openCard(page);

  const tile = page.getByTestId('tile-left-to-pay');
  await expect(tile).toContainText('2.000.000');
  await expect(tile.getByTestId('due-date')).toContainText(/^Due \d+ \w+ · /);
  await tile.getByRole('button', { name: 'Pay' }).click();
  await expect(tile.getByLabel('Amount (IDR)')).toHaveValue('2000000');
  await tile.getByRole('button', { name: 'Record payment' }).click();

  await expect(tile).toContainText('Paid in full');
  await expect(tile.getByTestId('due-date')).toHaveCount(0);
});

test('the tab you chose survives a reload', async ({ page }) => {
  await setUp(page);
  await openCard(page);
  await page.getByRole('tab', { name: 'Card & plans' }).click();
  await expect(page.getByRole('button', { name: 'Save terms' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Card & plans' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Save terms' })).toBeVisible();
});
