import { expect, test } from '@playwright/test';
import { at, bank, owedTo } from './debt-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the sidebar: Debt-free plan sits right after Net worth and opens the plan', async ({ page }) => {
  await page.clock.setSystemTime(at('2026-11-11'));
  await bank(page);
  await owedTo(page, 'Dewi', '850000');
  const links = page.locator('aside nav a');
  const names = await links.allInnerTexts();
  const at_ = names.findIndex((n) => n.trim() === 'Net worth');
  expect(names[at_ + 1]?.trim()).toMatch(/^Debt-free plan/);
  await page.locator('aside').getByRole('link', { name: /^Debt-free plan/ }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
  await expect(page.getByRole('heading', { name: 'Debt-free plan' })).toBeVisible();
});
