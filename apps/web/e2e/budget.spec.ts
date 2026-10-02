import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { budgetTab, openCapOf, openNewCap, setBudget } from './budget';
import { openGoalForm } from './goals';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function spendOnDinner(page: Page, amount: string) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Checking', balance: '20000000' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Checking', category: 'Restaurants', amount: amount });
  await expect(page.getByText('Warung Steak')).toBeVisible();
}

test('a cap on a parent counts what its children spent, and an over cap is listed as over', async ({ page }) => {
  await spendOnDinner(page, '500000');

  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '300000');

  // 500.000 spent under Restaurants against a 300.000 cap on the parent.
  const over = page.getByRole('heading', { name: 'Over the cap' });
  await expect(over).toBeVisible();
  const line = page.getByTestId('line-Food and beverage');
  await expect(line).toContainText('500.000');
  await expect(line).toContainText('over by');
  await expect(line).toContainText('200.000');
  // The card says the month is over, and by how much.
  await expect(page.getByTestId('left-to-spend')).toContainText('Over by Rp 200.000');

  // The row opens its cap: what was spent against it, read back.
  await line.click();
  const sheet = page.getByRole('dialog', { name: 'Food and beverage' });
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('300.000');
  await expect(sheet.getByTestId('cap-spent')).toContainText('500.000');
});

test('leaving the category untouched refuses to save, rather than capping the wrong one', async ({ page }) => {
  await page.goto('/budget');
  const sheet = await openNewCap(page);

  // Never opened, the Category row still reads as unset — not silently matched to whatever option sorts first.
  await expect(sheet.getByLabel('Category', { exact: true })).toHaveValue('');
  await sheet.getByLabel('Cap', { exact: true }).fill('300000');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a category');

  await page.keyboard.press('Escape');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('caps-total')).toContainText('Rp 0');
});

test('every spending category is listed, capped or not: the uncapped ones under No budget', async ({ page }) => {
  await page.goto('/budget');

  await expect(page.getByTestId('no-budget')).toContainText('categories');
  await page.getByTestId('no-budget').click();
  const list = page.getByRole('dialog', { name: 'No budget' });
  await expect(list.getByTestId('uncapped-Personal care')).toBeVisible();

  // Tapping one opens its cap.
  await list.getByTestId('uncapped-Personal care').click();
  const sheet = page.getByRole('dialog', { name: 'Personal care' });
  await sheet.getByLabel('Cap', { exact: true }).fill('400000');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByTestId('line-Personal care')).toContainText('left of 400.000');
});

test('an override changes one month and leaves the next alone', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '1000000');
  await expect(page.getByTestId('line-Food and beverage')).toContainText('1.000.000');

  await setBudget(page, 'Food and beverage', '9000000', true);
  await expect(page.getByTestId('line-Food and beverage')).toContainText('9.000.000');
  let sheet = await openCapOf(page, 'Food and beverage');
  await expect(sheet.getByLabel('Just this month')).toBeChecked();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('line-Food and beverage')).toContainText('left of 1.000.000');
  sheet = await openCapOf(page, 'Food and beverage');
  await expect(sheet.getByLabel('Just this month')).not.toBeChecked();
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('1.000.000');
});

test('Remove budget takes the cap off, and the category goes back under No budget', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Transportation', '900000');
  await expect(page.getByTestId('line-Transportation')).toBeVisible();

  await page.getByTestId('line-Transportation').click();
  await page.getByRole('dialog', { name: 'Transportation' }).getByRole('button', { name: 'Remove budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('line-Transportation')).toHaveCount(0);
  await page.getByTestId('no-budget').click();
  await expect(page.getByRole('dialog', { name: 'No budget' }).getByTestId('uncapped-Transportation')).toBeVisible();
});

test('the plan divides a typed take-home, and a bonus month is that month alone', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '5000000');
  await budgetTab(page, 'Plan');

  await page.getByTestId('income-line').click();
  let sheet = page.getByRole('dialog', { name: 'Take-home' });
  await sheet.getByLabel('Take-home', { exact: true }).fill('25000000');
  await sheet.getByRole('button', { name: 'Save take-home' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.getByTestId('income-line')).toContainText('25.000.000');
  await expect(page.getByTestId('caps-total')).toContainText('5.000.000');
  // Nothing owed and no goals, so 20 juta is left unplanned.
  await expect(page.getByTestId('left-over-plan')).toContainText('20.000.000');
  await expect(page.getByTestId('plan-legend')).toContainText('Budgeted 20%');

  // A bonus month: just this month, and the next is the usual figure again.
  await page.getByTestId('income-line').click();
  sheet = page.getByRole('dialog', { name: 'Take-home' });
  await sheet.getByLabel('Take-home', { exact: true }).fill('40000000');
  await sheet.getByLabel('Just this month').check();
  await sheet.getByRole('button', { name: 'Save take-home' }).click();
  await expect(page.getByTestId('income-line')).toContainText('40.000.000');
  await expect(page.getByTestId('income-line')).toContainText('Just this month');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('income-line')).toContainText('25.000.000');
  await expect(page.getByTestId('income-line')).not.toContainText('Just this month');
});

test('what the month has left so far is behind ⋯', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Month so far' }).click();
  await expect(page.getByTestId('left-over-actual')).toContainText('0');
});

test('a goal is listed on the plan with what it needs a month', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Education');
  await page.getByLabel('Name', { exact: true }).fill('School fees');
  await page.getByLabel(/Cost in today's money/).first().fill('120000000');
  await page.getByLabel('Needed by').first().fill('2030-06-30');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByTestId('goal-row').filter({ hasText: 'School fees' }).first()).toBeVisible();

  await page.goto('/budget');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('savings-School fees')).toContainText('a month');
});
