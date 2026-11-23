import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { budgetCells, budgetRow, capField, openEditBudgets, typeBudget } from './budget';
import { macV2 } from './mac-detail';

// Mac Budget's Categories typing table (and its gauge and split box) is v2's since option B (owner 2026-11-23): this
// file reads them, so the wide screen draws them. The phone is not affected.
test.beforeEach(async ({ page }) => {
  await macV2(page);
});

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
  // Reads the gauge (left-to-spend), a v2 part of Mac Budget.
  await macV2(page);
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
  await expect(page.getByTestId('edit-budgets')).toHaveCount(0);
  await expect(page.getByTestId('budget-page')).toBeVisible();
  const own = budgetCells(page, 'All Household');
  await expect(own.budget).toHaveText('1.000.000');
  // Nothing booked to Household itself: every row's Left is its Budget less its Spent, so "All Household" has all
  // of it left, and the group (Groceries' 340.000 spent in it) 660.000.
  await expect(own.spent).toHaveText('0');
  await expect(own.left).toHaveText('1.000.000');
  await expect(budgetCells(page, 'Household').left).toHaveText('660.000');
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

test('the gauge reads the Total budgeted row: a group’s whole Spent, its Budget, Left = Budget − Spent; Not budgeted is the rest', async ({ page }) => {
  // Reads the gauge and Needs a look, v2 parts of Mac Budget.
  await macV2(page);
  // Supplies spends with no budget of its own inside Household, whose Groceries has one: the group's Spent is all of it.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Toko Sabun', paidWith: 'Bank Sample', category: 'Supplies', amount: '120000' });
  await page.goto('/budget');
  await typeBudget(page, 'Groceries', '400000');
  await expect(budgetCells(page, 'Household').spent).toHaveText('460.000');
  await expect(page.getByTestId('total-budget')).toHaveText('400.000');
  await expect(page.getByTestId('total-spent')).toHaveText('460.000');
  // Over reads in words on the Mac: "60.000 over".
  await expect(page.getByTestId('total-left')).toHaveText('60.000 over');
  // The gauge and its lines say the Total row's figures, and over by the same 60.000.
  const box = page.getByTestId('left-to-spend');
  await expect(box.getByTestId('spent-of-budget')).toHaveText(/^Rp\s460\.000$/);
  await expect(box.getByTestId('budgeted-total')).toHaveText(/^Rp\s400\.000$/);
  await expect(box.getByRole('img')).toHaveAccessibleName(/^Rp\s60\.000 over budget by$/);
  // Not budgeted: Food and beverage alone (Restaurants), a top-level category with no budget anywhere in it.
  await expect(box.getByTestId('not-budgeted')).toHaveText(/^Rp\s500\.000$/);
  // Needs a look names the group by its row's figure, and the one category without a budget.
  const look = page.getByTestId('needs-a-look');
  await expect(look).toContainText('Household over');
  await expect(look).toContainText(/−Rp\s60\.000/);
  await expect(look).toContainText('1 category without a budget');
});

test('Edit budgets still sets any budget, and the table shows it', async ({ page }) => {
  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Restaurants')).field.fill('700000');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('edit-budgets')).toHaveCount(0);
  await expect(page.getByTestId('budget-page')).toBeVisible();
  await expect(budgetCells(page, 'Restaurants').budget).toHaveText('700.000');
  await expect(budgetCells(page, 'Restaurants').left).toHaveText('200.000');
  await expect(budgetCells(page, 'Food and beverage').budget).toHaveText('700.000');
  await expect(budgetCells(page, 'Food and beverage').left).toHaveText('200.000');

  // Over its budget, a sub-category's Left is "… over", in red, and takes its group's Left down with it.
  await typeBudget(page, 'Restaurants', '300000');
  const restaurants = budgetCells(page, 'Restaurants');
  await expect(restaurants.left).toHaveText('200.000 over');
  await expect(restaurants.left).toHaveClass(/mk-t-red/);
  await expect(budgetCells(page, 'Food and beverage').left).toHaveText('200.000 over');
  await expect(page.getByTestId('total-left')).toHaveText('200.000 over');
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
  // A row opens its receipt (the Mac receipt) in the category peek's place, with ‹ back to the category.
  await peek.getByTestId('peek-item').click();
  const receipt = page.getByTestId('receipt-peek');
  await expect(receipt.getByTestId('peek-title')).toHaveText('Pasar pagi');
  await expect(receipt.getByTestId('peek-amount')).toHaveText(/^Rp\s340\.000$/);
  await expect(page).toHaveURL(/\/budget/);
  await receipt.getByRole('button', { name: 'Back to Groceries' }).click();
  await expect(receipt).toHaveCount(0);
  await expect(peek.getByTestId('peek-title')).toHaveText('Groceries');

  // ↓ is the next category in the table's order (Food and beverage, under No budget yet).
  await page.keyboard.press('ArrowDown');
  await expect(peek.getByTestId('peek-title')).toHaveText('Food and beverage');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
});
