import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * Mac Budget, option B (owner 2026-11-23): the page shows the three tiles and a card for each of Essential, Lifestyle and
 * Debts & savings; Edit plan opens the right-hand form panel over the cards, rows grouped the same three ways, one
 * amount box a row (an amount or a %), Return to the next box, Save at the panel's foot. Invented figures.
 */

test.beforeEach(async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Pasar pagi', paidWith: 'Bank Sample', category: 'Groceries', amount: '340000' });
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'Bank Sample', category: 'Restaurants', amount: '500000' });
  await page.goto('/budget');
});

test('Edit plan opens in the panel over the cards, and a saved plan shows on its card with what is left or over', async ({ page }) => {
  // Nothing budgeted yet: no cards, a way to Edit plan, and no typing table (that is v2's).
  await expect(page.getByTestId('budget-cards-empty')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Categories' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit plan', exact: true }).first().click();
  const panel = page.getByTestId('form-panel');
  await expect(panel.getByRole('heading', { name: 'Edit plan' })).toBeVisible();
  await expect(page).toHaveURL(/\/budget\/edit/);
  // The cards stay drawn beside it.
  await expect(page.getByTestId('panel-base-page').getByTestId('budget-page')).toBeVisible();

  // Rows under what they count as; an empty box reads Set….
  const essential = panel.getByTestId('plan-group-essential');
  const lifestyle = panel.getByTestId('plan-group-lifestyle');
  const groceries = essential.getByLabel('Groceries', { exact: true });
  await expect(groceries).toHaveAttribute('placeholder', 'Set…');
  const restaurants = lifestyle.getByLabel('Restaurants', { exact: true });
  await expect(restaurants).toBeVisible();

  // Return moves to the next box, not out of the panel.
  await groceries.fill('400000');
  await groceries.press('Enter');
  await expect(groceries).not.toBeFocused();
  await expect(page).toHaveURL(/\/budget\/edit/);
  await restaurants.fill('450000');
  await expect(panel.getByTestId('edit-budgeted')).toHaveText(/^Rp\s850\.000$/);

  await panel.page().getByTestId('form-panel-foot').getByRole('button', { name: 'Save budgets', exact: true }).click();
  await expect(page.getByTestId('form-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/\/budget(\?|$)/);

  // Each saved budget on its card: spent of the budget, and what is left — or over, in red words.
  const groceriesRow = page.getByTestId('budget-card-essential').getByTestId('budget-card-row-Groceries');
  await expect(groceriesRow.getByTestId('budget-card-left')).toHaveText(/^Rp\s60\.000 left$/);
  await expect(groceriesRow.getByTestId('budget-card-of')).toHaveText(/^Rp\s340\.000 of Rp\s400\.000$/);
  const restaurantsRow = page.getByTestId('budget-card-lifestyle').getByTestId('budget-card-row-Restaurants');
  await expect(restaurantsRow.getByTestId('budget-card-left')).toHaveText(/^Rp\s50\.000 over$/);
});

test('Esc asks before it drops what was typed in Edit plan, and keeps the panel when the answer is no', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit plan', exact: true }).first().click();
  const panel = page.getByTestId('form-panel');
  const groceries = panel.getByTestId('plan-group-essential').getByLabel('Groceries', { exact: true });
  await groceries.fill('400000');

  let asked = 0;
  page.once('dialog', (dialog) => {
    asked += 1;
    void dialog.dismiss();
  });
  await groceries.press('Escape');
  await expect.poll(() => asked).toBe(1);
  await expect(panel).toBeVisible();
  await expect(groceries).toHaveValue('400.000');

  page.once('dialog', (dialog) => void dialog.accept());
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('form-panel')).toHaveCount(0);
  await expect(page.getByTestId('budget-cards-empty')).toBeVisible();
});
