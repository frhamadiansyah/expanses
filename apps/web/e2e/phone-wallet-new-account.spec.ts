import { expect, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('Wallet’s New account offers no Time deposit and no Other cash equivalents', async ({ page }) => {
  await page.goto('/accounts/add');
  const type = page.getByLabel('Type');
  await expect(type).toBeVisible({ timeout: 30_000 });
  const kinds = await type.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).textContent));
  expect(kinds).toContain('Current account');
  expect(kinds).not.toContain('Time deposit');
  expect(kinds).not.toContain('Other cash equivalents');
});
