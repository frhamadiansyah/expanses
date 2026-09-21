import { expect, type Page, test } from '@playwright/test';
import { goalCard, jeniusWithTwoGoals, openExpense, typeAmount } from './set-aside';

/*
 * Every door that pays money out of an account with money set aside, on the laptop's figures: Jenius holds
 * Rp 42.500.000, promises Rp 37.500.000 (Emergency fund 30.000.000 first, Umrah 7.500.000), so Rp 5.000.000 is free
 * and a Rp 6.800.000 payment is Rp 1.800.000 over. Each door asks, keeps its save shut until answered, and the
 * answer lands on the goal as a shortfall of exactly what went over — not the whole payment, and not nothing.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = local(now);
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));

async function expectShort(page: Page, goal: string, figure: RegExp) {
  await page.goto('/goals');
  await expect(goalCard(page, goal).getByText(figure)).toBeVisible();
}

/** Answers the question in `scope`: the Emergency fund, borrowing. */
async function borrowFromEmergencyFund(scope: ReturnType<Page['locator']>) {
  await scope.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await scope.getByRole('button', { name: 'No — borrowing from it' }).click();
}

// ── Cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addCard(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').pressSequentially('31');
  await page.getByLabel('Due date').pressSequentially('15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('radio', { name: 'Activity' }).click();
  await expect(page.getByText('Statements')).toBeVisible();
}

async function buyOnCard(page: Page, note: string, amount: string, on: string) {
  const form = await openExpense(page, 'BCA Visa');
  await typeAmount(page, form, amount);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').pressSequentially(note);
  await form.getByLabel('Date').fill(on);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
}

async function openCard(page: Page) {
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
}

test('paying the card bill from Jenius asks, and the Emergency fund lends the 1.800.000', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addCard(page);
  await buyOnCard(page, 'Laptop', '6800000', LAST_MONTH);
  await openCard(page);

  const tile = page.getByTestId('tile-left-to-pay');
  await tile.getByRole('button', { name: 'Pay this bill' }).click();
  await expect(tile.getByLabel('Amount (IDR)')).toHaveValue('6800000');
  await expect(tile.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(tile.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  await borrowFromEmergencyFund(tile);
  await tile.getByRole('button', { name: 'Record payment' }).click();
  await expect(tile).toContainText('Paid in full');

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('paying chosen purchases now from Jenius asks the same question', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addCard(page);
  await buyOnCard(page, 'Laptop', '6800000', TODAY);
  await openCard(page);

  await page.getByLabel('Pay Laptop').check();
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const pay = page.getByRole('button', { name: /^Pay Rp/ });
  await expect(pay).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await pay.click();
  await expect(page.getByLabel(/^Laptop, paid on/)).toBeChecked();

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

// ── Bills ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addBill(page: Page, name: string, amount: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).pressSequentially(name);
  await page.getByLabel('Amount', { exact: true }).pressSequentially(amount);
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'Jenius' });
  await page.getByLabel('Bill is out on').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bill-row').filter({ hasText: name })).toBeVisible();
}

test('paying a bill from Jenius asks, and Record waits for the answer', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addBill(page, 'Rent', '6800000');
  await page.getByTestId('bill-row').filter({ hasText: 'Rent' }).click();
  await page.getByRole('button', { name: /^Pay \w+ bill$/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay Rent' });
  await expect(sheet.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const record = sheet.getByRole('button', { name: 'Record payment' });
  await expect(record).toBeDisabled();
  // Enter in the amount is a submit too: it must not go round the question.
  await sheet.getByLabel('What it came to').press('Enter');
  await expect(sheet).toBeVisible();
  await borrowFromEmergencyFund(sheet);
  await record.click();
  await expect(sheet).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('paying several bills asks once for what they take together, spread over the bills in order', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  // Each fits the Rp 5.000.000 free on its own; together they are Rp 2.000.000 over.
  await addBill(page, 'Rent', '3000000');
  await addBill(page, 'School', '4000000');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Rent' }).click();
  await page.getByRole('checkbox', { name: 'Select School' }).click();
  await page.getByRole('button', { name: /^Pay 2 selected/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await expect(sheet.getByText(/2\.000\.000 more than is free/)).toBeVisible();
  const record = sheet.getByRole('button', { name: 'Record 2 bills' });
  await expect(record).toBeDisabled();
  await borrowFromEmergencyFund(sheet);
  await record.click();
  await expect(sheet).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.2\.000\.000/i);
});
