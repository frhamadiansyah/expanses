import { expect, test } from '@playwright/test';
import { at, bank, owedTo, seedLatePaylater } from './debt-plan';

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

test('wide: the plan beside its numbered list, the extra moves the month, and Pay opens the loan’s sheet', async ({ page }) => {
  await seedLatePaylater(page);
  await owedTo(page, 'Dewi', '850000');
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-header')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Order' })).toBeVisible();
  await expect(page.getByLabel('Extra a month')).toBeVisible();
  const heads = page.getByTestId('plan-table').locator('thead th');
  await expect(heads).toHaveText(['#', 'Debt', 'Rate', 'Progress', 'Left', 'Pay']);
  // The late paylater first, Dewi after it.
  await expect.poll(() => page.getByTestId('plan-table-row').evaluateAll((els) => els.map((el) => el.getAttribute('data-name')))).toEqual(['Kredit', 'Dewi']);
  await expect(page.getByTestId('plan-table-row').first()).toContainText('3 days late');

  const extra = page.getByLabel('Extra a month');
  await extra.fill('3000000');
  await extra.press('Enter');
  await expect(page.getByTestId('plan-extra-debt-free')).toContainText('December 2026');

  await page.getByRole('link', { name: 'Pay Kredit' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^?]+\?pay=due$/);
  await expect(page.getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Save payment' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
});
