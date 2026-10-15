import { expect, type Page, test } from '@playwright/test';
import { budgetTab, capField, openCapOf, openEditBudgets } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function setTakeHome(page: Page, figure: string) {
  await budgetTab(page, 'Plan');
  await page.getByTestId('income-line').click();
  const sheet = page.getByRole('dialog', { name: 'Take-home' });
  await sheet.getByLabel('Take-home', { exact: true }).fill(figure);
  await sheet.getByRole('button', { name: 'Save take-home' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await budgetTab(page, 'Spending');
}

test('a budget set as 30% of take-home follows the take-home when it changes', async ({ page }) => {
  await page.goto('/budget');
  await setTakeHome(page, '10000000');

  const screen = await openEditBudgets(page);
  const { field, label } = await capField(screen, 'Food and beverage');
  await screen.getByLabel(`${label} every`).selectOption('share');
  await field.fill('30');
  await expect(screen.getByTestId('edit-budgeted')).toContainText('3.000.000');
  await expect(screen.getByTestId('edit-share')).toContainText('30% of take-home');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('line-Food and beverage')).toContainText('left of 3.000.000');

  await setTakeHome(page, '12000000');
  await expect(page.getByTestId('line-Food and beverage')).toContainText('left of 3.600.000');
});

test('the sheet turns a figure into its % and back, and keeps the budget a % after saving', async ({ page }) => {
  await page.goto('/budget');
  await setTakeHome(page, '12000000');
  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Household')).field.fill('1860000');
  await page.getByRole('button', { name: 'Save budgets' }).click();

  const sheet = await openCapOf(page, 'Household');
  await sheet.getByRole('radio', { name: '%' }).click();
  await expect(sheet.getByLabel('Share', { exact: true })).toHaveValue('15,5');
  await expect(sheet).toContainText('of take-home');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const again = await openCapOf(page, 'Household');
  await expect(again.getByRole('radio', { name: '%' })).toHaveAttribute('aria-checked', 'true');
  await expect(again.getByLabel('Share', { exact: true })).toHaveValue('15,5');
});

test('a % of a parent: removing the parent asks first, and the child keeps its figure as an amount', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  const parent = await capField(screen, 'Household');
  await parent.field.fill('2000000');
  const child = await capField(screen, 'Groceries');
  await screen.getByLabel(`${child.label} every`).selectOption('share');
  await child.field.fill('40');
  await expect(screen.getByTestId('edit-row-Groceries')).toContainText('of Household');
  await page.getByRole('button', { name: 'Save budgets' }).click();

  page.removeAllListeners('dialog');
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  const sheet = await openCapOf(page, 'Household');
  await sheet.getByRole('button', { name: 'Remove budget' }).click();
  await expect.poll(() => asked).toMatch(/Groceries keeps Rp\s800\.000 a month/);

  const groceries = await openCapOf(page, 'Groceries');
  await expect(groceries.getByRole('radio', { name: 'Amount' })).toHaveAttribute('aria-checked', 'true');
  await expect(groceries.getByLabel('Cap', { exact: true })).toHaveValue('800.000');
});
