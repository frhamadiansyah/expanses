import { expect, test } from '@playwright/test';
import { at, bank, owedTo, seedLatePaylater, seedMonth } from './debt-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the sidebar: Debt-free plan closes the Plans group, after Events, and opens the plan', async ({ page }) => {
  await page.clock.setSystemTime(at('2026-11-11'));
  await bank(page);
  await owedTo(page, 'Dewi', '850000');
  const links = page.locator('aside nav a');
  const names = await links.allInnerTexts();
  const at_ = names.findIndex((n) => n.trim() === 'Events');
  expect(names[at_ + 1]?.trim()).toMatch(/^Debt-free plan/);
  await page.locator('aside').getByRole('link', { name: /^Debt-free plan/ }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
  await expect(page.getByRole('heading', { name: 'Debt-free plan' })).toBeVisible();
});

test('wide: the Mac plan’s table in pay order, the extra moves the chart’s month, and Pay opens the loan’s sheet', async ({ page }) => {
  await seedLatePaylater(page);
  await owedTo(page, 'Dewi', '850000');
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-header')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Order' })).toBeVisible();
  await expect(page.getByLabel('Extra a month')).toBeVisible();
  const heads = page.getByTestId('plan-table').locator('thead th');
  await expect(heads).toHaveText(['#', 'Debt', 'Rate', 'Progress', 'Left', 'Next', 'Late', 'Pay']);
  // The late paylater first, Dewi after it.
  await expect.poll(() => page.getByTestId('plan-table-row').evaluateAll((els) => els.map((el) => el.getAttribute('data-name')))).toEqual(['Kredit', 'Dewi']);
  await expect(page.getByTestId('plan-table-row').first()).toContainText('1 payment late');

  const extra = page.getByLabel('Extra a month');
  await extra.fill('3000000');
  await extra.press('Enter');
  await expect(page.getByTestId('plan-chart-with')).toContainText('with extra · debt-free Dec 2026');

  await page.getByRole('link', { name: 'Pay Kredit' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^?]+\?pay=due$/);
  await expect(page.getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Save payment' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
});

test('wide: the Schedule view is its own address, the month’s late and the next 30 days', async ({ page }) => {
  await seedMonth(page);
  await page.goto('/net-worth/plan');
  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Schedule' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/schedule$/);
  await expect(page.getByTestId('schedule-month')).toHaveText('November');
  await expect(page.getByTestId('schedule-late').getByTestId('schedule-row')).toContainText('Kredit · 1/6');
  // November's two (Electricity by the 12th, BCA Visa by the 14th) and Kredit's December one, inside 30 days.
  await expect(page.getByTestId('schedule-coming-up').getByTestId('schedule-row')).toHaveCount(3);
  await page.reload();
  await expect(page.getByTestId('schedule-panel')).toBeVisible();
});

test('wide: Plan, Schedule and Report switch in the title bar, and ?tab=report opens the Report', async ({ page }) => {
  await seedMonth(page);
  await page.goto('/net-worth/plan');
  const view = page.getByRole('radiogroup', { name: 'View' });
  await view.getByRole('radio', { name: 'Report' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/report$/);
  await expect(page.getByTestId('report-borrowed')).toBeVisible();
  await view.getByRole('radio', { name: 'Schedule' }).click();
  await expect(page.getByTestId('schedule-panel')).toBeVisible();
  await view.getByRole('radio', { name: 'Plan' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan$/);
  await expect(page.getByTestId('plan-table')).toBeVisible();
  await page.goto('/net-worth/plan?tab=report');
  await expect(page.getByTestId('report-borrowed')).toBeVisible();
});
