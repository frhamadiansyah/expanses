import { macV2 } from './mac-detail';
import { expect, test } from '@playwright/test';
import { budgetCells, budgetTab, capField, openCapOf, openDrawer, openEditBudgets } from './budget';

// Mac Budget's Categories typing table (and its gauge and split box) is v2's since option B (owner 2026-11-23): this
// file reads them, so the wide screen draws them. The phone is not affected.
test.beforeEach(async ({ page }) => {
  await macV2(page);
});

test('a weekly line is shown and counted as 52/12 of a week', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  const { field, label } = await capField(screen, '— Groceries');
  await screen.getByLabel(`${label} every`).selectOption('weekly');
  await field.click();
  await field.pressSequentially('500000', { delay: 30 });
  await expect(screen.getByTestId('edit-budgeted')).toContainText('2.166.667');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('edit-budgets')).toHaveCount(0);
  await expect(page.getByTestId('budget-page')).toBeVisible();

  // Folded under its parent, and read a month at a time.
  await openDrawer(page, 'Household');
  await expect(budgetCells(page, 'Groceries').budget).toHaveText('weekly · 2.166.667');
  await expect(budgetCells(page, 'Groceries').left).toHaveText('2.166.667');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');

  // The cap keeps the unit it was typed in.
  const again = await openCapOf(page, '— Groceries');
  await expect(again.getByLabel('Cap', { exact: true })).toHaveValue('500.000');
  await expect(again.getByLabel('Every')).toHaveValue('weekly');
});
