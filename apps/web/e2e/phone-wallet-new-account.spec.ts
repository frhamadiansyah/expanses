import { expect, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('Wallet’s New account offers Credit card, but no Fund account, no Time deposit and no Other cash equivalents', async ({ page }) => {
  await page.goto('/accounts/add');
  const type = page.getByLabel('Type');
  await expect(type).toBeVisible({ timeout: 30_000 });
  const kinds = await type.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).textContent));
  expect(kinds).toContain('Current account');
  expect(kinds.at(-1)).toBe('Credit card');
  expect(kinds).not.toContain('Fund account');
  expect(kinds).not.toContain('Time deposit');
  expect(kinds).not.toContain('Other cash equivalents');
});

test('Choosing Credit card in the Type row shows the card form, and a money kind brings the account form back', async ({ page }) => {
  await page.goto('/accounts/add');
  const type = page.getByLabel('Type', { exact: true });
  await expect(type).toBeVisible({ timeout: 30_000 });
  await type.selectOption({ label: 'Credit card' });
  await expect(page.getByLabel('Last 4 digits', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add account' })).toHaveCount(0);
  await expect(type).toHaveValue('credit_card');
  await type.selectOption({ label: 'Current account' });
  await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  await expect(page.getByLabel('Last 4 digits', { exact: true })).toHaveCount(0);
});
