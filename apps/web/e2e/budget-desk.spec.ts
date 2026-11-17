import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { budgetCells, budgetRow, capField, openEditBudgets, typeBudget } from './budget';

/*
 * Budget on a wide screen (Mac Budget, the list version): budgets typed straight into the Categories table, saved as
 * Edit budgets saves them, and the category's side peek. Invented figures.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Pasar pagi', paidWith: 'Bank Sample', category: 'Groceries', amount: '340000' });
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'Bank Sample', category: 'Restaurants', amount: '500000' });
  await page.goto('/budget');
});

test('a budget typed into its cell saves at once, and Left, the total and the gauge follow', async ({ page }) => {
  const groceries = budgetCells(page, 'Groceries');
  // Spent with no budget: under No budget yet, a Set… where the budget goes.
  await expect(groceries.budget).toHaveText('Set…');
  await expect(groceries.spent).toHaveText('340.000');
  await expect(groceries.left).toHaveText('—');
  await expect(page.getByTestId('budget-total')).toHaveCount(0);

  await typeBudget(page, 'Groceries', '400000');
  await expect(groceries.budget).toHaveText('400.000');
  await expect(groceries.left).toHaveText('60.000');
  await expect(page.getByTestId('total-budget')).toHaveText('400.000');
  await expect(page.getByTestId('total-left')).toHaveText('60.000');
  await expect(page.getByTestId('left-to-spend').getByRole('img')).toHaveAccessibleName(/^Rp\s60\.000 left to spend$/);

  // A group's Spent is the whole category's; "All Household" is only listed once Household has a budget (or money) of
  // its own, so its rows add up to the group: here Groceries alone.
  await expect(budgetCells(page, 'Household').spent).toHaveText('340.000');
  await expect(budgetRow(page, 'All Household')).toHaveCount(0);

  // The parent's own budget (set on Edit budgets: it has no row of its own yet), then Tab down to Groceries, typed as a % of it.
  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Household')).field.fill('1000000');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('budget-page')).toBeVisible();
  const own = budgetCells(page, 'All Household');
  await expect(own.budget).toHaveText('1.000.000');
  // Nothing booked to Household itself; its budget covers Groceries too.
  await expect(own.spent).toHaveText('0');
  await expect(own.left).toHaveText('660.000');
  await page.getByRole('button', { name: 'Budget for All Household', exact: true }).click();
  await page.keyboard.press('Tab');
  const field = page.getByRole('textbox', { name: 'Budget for Groceries', exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('400.000');
  await field.fill('50%');
  await field.press('Enter');
  await expect(groceries.budget).toHaveText('50% · 500.000');
  await expect(groceries.left).toHaveText('160.000');
  // The parent's budget covers everything under it: the total counts it once.
  await expect(budgetCells(page, 'Household').budget).toHaveText('1.000.000');
  await expect(page.getByTestId('total-budget')).toHaveText('1.000.000');
  await expect(page.getByTestId('total-left')).toHaveText('660.000');

  // Esc leaves the cell as it was.
  await page.getByRole('button', { name: 'Budget for Groceries', exact: true }).click();
  await page.keyboard.type('999');
  await page.keyboard.press('Escape');
  await expect(groceries.budget).toHaveText('50% · 500.000');

  // A figure that cannot be read is refused in place, and nothing is saved.
  await page.getByRole('button', { name: 'Budget for Restaurants', exact: true }).click();
  await page.keyboard.type('lots');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('That figure cannot be read');
  await page.keyboard.press('Escape');
  await expect(budgetCells(page, 'Restaurants').budget).toHaveText('Set…');

  // Clearing the parent would leave its %-child with nothing to be a share of: Edit budgets asks about that.
  await page.getByRole('button', { name: 'Budget for All Household', exact: true }).click();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('edit-budgets')).toBeVisible();
});

test('Edit budgets still sets any budget, and the table shows it', async ({ page }) => {
  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Restaurants')).field.fill('700000');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('budget-page')).toBeVisible();
  await expect(budgetCells(page, 'Restaurants').budget).toHaveText('700.000');
  await expect(budgetCells(page, 'Restaurants').left).toHaveText('200.000');
  await expect(budgetCells(page, 'Food and beverage').budget).toHaveText('700.000');
});

test('a category’s name opens its side peek: the month’s figures and transactions, stepped with ↓ and closed with Esc', async ({ page }) => {
  await typeBudget(page, 'Groceries', '400000');
  await budgetRow(page, 'Groceries').getByRole('button', { name: 'Groceries', exact: true }).click();
  const peek = page.getByTestId('category-peek');
  await expect(peek.getByTestId('peek-title')).toHaveText('Groceries');
  await expect(peek.getByTestId('peek-amount')).toHaveText(/Rp\s340\.000/);
  await expect(peek.getByTestId('peek-left')).toHaveText(/Rp\s60\.000 left of Rp\s400\.000/);
  await expect(peek.getByTestId('peek-item')).toHaveCount(1);
  await expect(peek.getByTestId('peek-item')).toContainText('Pasar pagi');

  // ↓ is the next category in the table's order (Food and beverage, under No budget yet).
  await page.keyboard.press('ArrowDown');
  await expect(peek.getByTestId('peek-title')).toHaveText('Food and beverage');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
});
