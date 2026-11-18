import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { budgetCells, budgetRow, budgetTab, capField, monthSoFar, openCapOf, openEditBudgets, setBudget } from './budget';
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

  // 500.000 spent under Restaurants against a 300.000 cap on the parent: the group row says so. Every row's Left is its
  // own Budget less its own Spent, so "All Food and beverage" (nothing booked to the parent itself) has all 300.000.
  const group = budgetCells(page, 'Food and beverage');
  await expect(group.budget).toHaveText('300.000');
  await expect(group.spent).toHaveText('500.000');
  await expect(group.left).toHaveText('−200.000');
  await expect(budgetCells(page, 'All Food and beverage').spent).toHaveText('0');
  await expect(budgetCells(page, 'All Food and beverage').left).toHaveText('300.000');
  // Needs a look names it, and the gauge says the month is over, and by how much.
  await expect(page.getByTestId('needs-a-look')).toContainText('Food and beverage over');
  await expect(page.getByTestId('needs-a-look')).toContainText(/−Rp\s200\.000/);
  await expect(page.getByTestId('left-to-spend').getByRole('img')).toHaveAccessibleName(/^Rp\s200\.000 over budget by$/);

  // Its name opens the side peek, and Edit budget its cap: what was spent against it, read back.
  const sheet = await openCapOf(page, 'Food and beverage');
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('300.000');
  await expect(sheet.getByTestId('cap-spent')).toContainText('500.000');
});

test('every spending category can be budgeted on Edit budgets, capped or not', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  const { field } = await capField(screen, 'Personal care');
  await expect(field).toHaveValue('');
  await field.fill('400000');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(budgetCells(page, 'Personal care').budget).toHaveText('400.000');
  await expect(budgetCells(page, 'Personal care').left).toHaveText('400.000');
});

test('an override changes one month and leaves the next alone', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '1000000');
  await expect(budgetCells(page, 'All Food and beverage').budget).toHaveText('1.000.000');

  await setBudget(page, 'Food and beverage', '9000000', true);
  // The month's own figure, said as such.
  await expect(budgetCells(page, 'All Food and beverage').budget).toHaveText('this month · 9.000.000');
  let sheet = await openCapOf(page, 'Food and beverage');
  await expect(sheet.getByLabel('Just this month')).toBeChecked();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(budgetCells(page, 'All Food and beverage').budget).toHaveText('1.000.000');
  sheet = await openCapOf(page, 'Food and beverage');
  await expect(sheet.getByLabel('Just this month')).not.toBeChecked();
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('1.000.000');
});

test('Remove budget takes the cap off, and the category is uncapped again', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Transportation', '900000');
  await expect(budgetRow(page, 'Transportation')).toBeVisible();

  const sheet = await openCapOf(page, 'Transportation');
  await sheet.getByRole('button', { name: 'Remove budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Nothing was spent on it, so with its budget gone it leaves the table.
  await expect(budgetRow(page, 'Transportation')).toHaveCount(0);
  // Nothing was spent on it, so it waits on Edit budgets, empty, rather than under No budget yet.
  const screen = await openEditBudgets(page);
  await expect((await capField(screen, 'Transportation')).field).toHaveValue('');
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

test('what the month has left so far is a box of the Plan view', async ({ page }) => {
  await page.goto('/budget');
  await monthSoFar(page);
  await expect(page.getByTestId('left-over-actual')).toContainText('0');
});

test('a goal is listed on the plan with what it needs a month', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Education');
  await page.getByLabel('Name', { exact: true }).fill('School fees');
  await page.getByLabel(/Cost today/).first().fill('120000000');
  await page.getByLabel('Due by').first().fill('2030-06-30');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(page.getByTestId('goal-row').filter({ hasText: 'School fees' }).first()).toBeVisible();

  await page.goto('/budget');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('savings-School fees')).toContainText('a month');
});
