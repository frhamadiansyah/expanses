import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function spendOnGroceries(page: Page, amount: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Checking');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Checking' })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Superindo');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Checking (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Superindo')).toBeVisible();
}

async function setBudget(page: Page, category: string, amount: string, thisMonthOnly = false) {
  await page.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await page.getByLabel('Monthly amount (IDR)').fill(amount);
  if (thisMonthOnly) await page.getByLabel('Just this month').check();
  else await page.getByLabel('Just this month').uncheck();
  await page.getByRole('button', { name: 'Set budget' }).click();
}

test('a cap on a parent counts what its children spent', async ({ page }) => {
  await spendOnGroceries(page, '500000');

  await page.goto('/budget');
  await setBudget(page, 'Food & Drink', '300000');

  // 500.000 spent under Groceries against a 300.000 cap on the parent.
  await expect(page.getByTestId('line-Food & Drink')).toContainText('Over by');
  await expect(page.getByTestId('line-Food & Drink')).toContainText('200.000');
});

test('every spending category appears, capped or not', async ({ page }) => {
  await page.goto('/budget');

  await expect(page.getByTestId('line-Personal Care')).toBeVisible();
  await expect(page.getByTestId('line-Personal Care')).toContainText('No budget');
});

test('an override changes one month and leaves the next alone', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Food & Drink', '1000000');
  await expect(page.getByTestId('line-Food & Drink')).toContainText('1.000.000');

  await setBudget(page, 'Food & Drink', '9000000', true);
  await expect(page.getByTestId('line-Food & Drink')).toContainText('9.000.000');
  await expect(page.getByTestId('line-Food & Drink')).toContainText('just this month');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('line-Food & Drink')).toContainText('1.000.000');
  await expect(page.getByTestId('line-Food & Drink')).not.toContainText('just this month');
});

test('the sheet plans against typed income and reports what happened', async ({ page }) => {
  await page.goto('/budget');
  await page.getByLabel('Expected take-home (IDR)').fill('25000000');
  await page.getByRole('button', { name: 'Set income' }).click();
  await setBudget(page, 'Food & Drink', '5000000');

  await expect(page.getByTestId('income-line')).toContainText('25.000.000');
  // Nothing earned or spent yet, so the plan has 20 juta left and the month itself has nothing.
  await expect(page.getByTestId('left-over-plan')).toContainText('20.000.000');
  await expect(page.getByTestId('left-over-actual')).toContainText('0');
});

test('a goal becomes a savings row on the sheet', async ({ page }) => {
  await page.goto('/net-worth/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('education');
  await page.getByLabel('Name', { exact: true }).fill('School fees');
  await page.getByLabel(/Cost in today's money/).first().fill('120000000');
  await page.getByLabel('Needed by').first().fill('2030-06-30');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name: 'School fees' })).toBeVisible();

  await page.goto('/budget');
  await expect(page.getByTestId('savings-School fees')).toContainText('a month');
});
