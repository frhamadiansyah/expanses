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

/**
 * A workspace started empty keeps its own categories from the first day: none of Personal's are there to pick, and
 * the picker fills as they are added. Only the handful the app posts into by itself — loan interest, a realised
 * gain — are made with it, so that a repayment recorded here is recorded here.
 */
test('a workspace is made from ⋯ and starts with none of the other’s categories', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'New workspace' }).click();

  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  // There is one Personal already, so the tile for it is refused rather than hidden: the reason is worth reading.
  await expect(sheet.getByRole('button', { name: 'Personal' })).toBeDisabled();
  await expect(sheet.getByLabel('Starts with')).toHaveValue('');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByTestId('filters-menu').getByTestId('workspace-row')).toContainText('Business');
  await page.keyboard.press('Escape');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add a transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await expect(form.getByLabel('Category').locator('option', { hasText: 'Restaurants' })).toHaveCount(0);
  await expect(form.getByLabel('Category').locator('option', { hasText: 'Interest' })).toHaveCount(1);
});
