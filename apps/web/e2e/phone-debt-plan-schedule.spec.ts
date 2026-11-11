import { expect, type Page, test } from '@playwright/test';
import { at, seedMonth } from './debt-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const section = (page: Page, id: string) => page.getByTestId(id);
const row = (page: Page, id: string, title: string) => section(page, id).getByTestId('schedule-row').filter({ hasText: title });

test('schedule: the month’s late, coming up and paid, and Pay from a row comes back to it', async ({ page }) => {
  await seedMonth(page);
  await page.goto('/net-worth/plan/schedule');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByTestId('schedule-month')).toHaveText('Nov 2026');
  await expect(row(page, 'schedule-late', 'Kredit · 1/6')).toContainText('10 days late');
  await expect(row(page, 'schedule-coming-up', 'Electricity')).toContainText('Tomorrow');
  await expect(row(page, 'schedule-coming-up', 'BCA Visa')).toContainText('14 Nov');
  await expect(page.getByTestId('schedule-tile-late')).toContainText('Rp 1.071.155');

  await row(page, 'schedule-coming-up', 'Electricity').getByRole('link', { name: 'Pay Electricity' }).click();
  await expect(page).toHaveURL(/\/bills\/[^?]+\?pay=true$/);
  await page.getByRole('dialog', { name: 'Pay Electricity' }).getByRole('button', { name: 'Record payment' }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/schedule/);
  await expect(row(page, 'schedule-paid', 'Electricity')).toContainText('Paid 11 Nov');
  await expect(page.getByTestId('schedule-tile-paid')).toContainText('Rp 780.000');

  // The plan's row counts what is still due this month: Kredit and BCA Visa.
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('plan-row-schedule')).toContainText('2 due this month');

  await page.goto('/net-worth/plan/schedule');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('dialog', { name: 'Show' }).getByRole('checkbox', { name: 'Bills' }).click();
  await page.getByRole('dialog', { name: 'Show' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('schedule-row').filter({ hasText: 'Electricity' })).toHaveCount(0);
  await expect(page.getByTestId('schedule-tile-paid')).toContainText('Rp 0');

  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByTestId('schedule-month')).toHaveText('Oct 2026');
  await expect(page.getByTestId('schedule-late')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('cashflow: what is late or due within three days, one tap from paying it', async ({ page }) => {
  await seedMonth(page);
  await page.goto('/transactions');
  const due = page.getByTestId('due-row');
  await expect(due).toContainText('Kredit instalment');
  await expect(due).toContainText('10 days late · +2 more');
  await due.click();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^?]+\?pay=due$/);
  await page.getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Save payment' }).click();
  await expect(page).toHaveURL(/\/transactions/);

  // Kredit paid; Electricity is due tomorrow and BCA Visa in 3 days.
  await expect(page.getByTestId('due-row')).toContainText('Electricity');
  await expect(page.getByTestId('due-row')).toContainText('Due tomorrow · +1 due in 3 days');
});

test('cashflow: nothing late and nothing due soon, no row', async ({ page }) => {
  await seedMonth(page, { paylater: false });
  await page.clock.setSystemTime(at('2026-11-01'));
  await page.goto('/transactions');
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('due-row')).toHaveCount(0);
});
