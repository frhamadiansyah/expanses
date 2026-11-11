import { expect, test } from '@playwright/test';
import { seedPlan } from './debt-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the plan’s header: left to pay, the counts, the order and what to pay next', async ({ page }) => {
  await seedPlan(page);
  await page.goto('/net-worth/plan');
  await expect(page.getByRole('heading', { name: 'Debt-free plan' })).toBeVisible();
  await expect(page.getByTestId('plan-left')).toHaveText('Rp 35.464.300');
  await expect(page.getByTestId('plan-count-active')).toHaveText('3 active');
  await expect(page.getByTestId('plan-count-late')).toHaveText('0 late');
  await expect(page.getByTestId('plan-count-paid-off')).toHaveText('0 paid off');
  // One debt charges interest and Dewi alone is small: no suggestion, so the plan starts on Avalanche.
  await expect(page.getByTestId('plan-row-pay-first')).toContainText('Avalanche');
  await expect(page.getByTestId('plan-pay-next')).toContainText('BCA Visa');
  await expect(page.getByTestId('plan-pay-next')).toContainText('due 18 Nov');
  await expect(page.getByTestId('plan-ring')).toHaveAttribute('aria-label', /^\d+% repaid$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
