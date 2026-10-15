import { expect, test } from '@playwright/test';
import { capField, openDrawer } from './budget';

test('a yearly line is typed at phone width and counted as a twelfth of the year', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'Edit budgets', exact: true }).tap();
  const screen = page.getByTestId('edit-budgets');
  const { field, label } = await capField(screen, 'Groceries');
  await screen.getByLabel(`${label} every`).selectOption('yearly');
  await field.tap();
  await field.pressSequentially('2400000', { delay: 30 });
  await expect(screen.getByTestId('edit-budgeted')).toContainText('200.000');
  await page.getByRole('button', { name: 'Save budgets' }).tap();
  await expect(page.getByTestId('budget-page')).toBeVisible();

  await openDrawer(page, 'Household');
  await expect(page.getByTestId('line-Groceries')).toContainText('left of 200.000');
  await page.getByTestId('line-Groceries').tap();
  await expect(page.getByRole('dialog', { name: 'Groceries' }).getByLabel('Cap', { exact: true })).toHaveValue('2.400.000');
  await expect(page.getByRole('dialog', { name: 'Groceries' }).getByLabel('Every')).toHaveValue('yearly');
});
