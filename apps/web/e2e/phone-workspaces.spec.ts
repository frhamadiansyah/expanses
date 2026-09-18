import { expect, test } from '@playwright/test';

/**
 * On a phone the ⋯ menu is the only room left for anything that is not the list itself, so the workspace sits
 * at the top of it: above the three filters, because it changes the whole app where they narrow one month.
 */
test('the workspace is the first thing under ⋯, and opens the switcher', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  const menu = page.getByTestId('filters-menu');
  await expect(menu.getByTestId('workspace-row')).toBeVisible();
  // It comes before the three filters, because it changes the app rather than narrowing the list.
  await expect(menu.getByRole('menuitem').first()).toHaveAttribute('data-testid', 'workspace-row');
  await expect(menu.getByTestId('workspace-row')).toContainText('Personal');
  await menu.getByTestId('workspace-row').click();
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toBeVisible();
  await expect(page.getByTestId('workspace-choice')).toHaveCount(1);
});
