import { expect, test } from '@playwright/test';
import { openGoalForm } from './goals';
import { goalRow } from './set-aside';

/*
 * A goal counted in a currency of its own: a Currency row on the New goal page, the amount rows read in that
 * currency, and the saved goal shows its cost in it (EUR with cents, JPY with none).
 */

test('a goal is added in euros: the amount rows name the currency and the list shows euros', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Holiday');
  await page.getByLabel('Name', { exact: true }).fill('Leather bag');
  await expect(page.getByLabel(/Cost in today's money/).first()).toBeVisible();

  await page.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await expect(page.getByLabel("Cost in today's money (EUR)")).toBeVisible();
  await page.getByLabel("Cost in today's money (EUR)").fill('1250.50');
  await page.getByRole('button', { name: 'Save goal' }).click();

  await expect(page).toHaveURL(/\/goals$/);
  const row = goalRow(page, 'Leather bag');
  await expect(row).toBeVisible();
  await expect(row).toContainText('€');
  await expect(row).not.toContainText('Rp');
});

test('a zero-decimal currency takes whole units', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Holiday');
  await page.getByLabel('Name', { exact: true }).fill('Kyoto trip');
  await page.getByLabel('Currency', { exact: true }).selectOption('JPY');
  await page.getByLabel("Cost in today's money (JPY)").fill('300000');
  await page.getByRole('button', { name: 'Save goal' }).click();

  await expect(page).toHaveURL(/\/goals$/);
  const row = goalRow(page, 'Kyoto trip');
  await expect(row).toBeVisible();
  await expect(row).toContainText('¥');
});

test('the saved goal reopens with its currency', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Education');
  await page.getByLabel('Name', { exact: true }).fill('Tuition abroad');
  await page.getByLabel('Currency', { exact: true }).selectOption('USD');
  await page.getByLabel("Cost in today's money (USD)").fill('20000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page).toHaveURL(/\/goals$/);

  await goalRow(page, 'Tuition abroad').click();
  await page.getByRole('button', { name: 'More', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Edit$/ }).first().click();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('USD');
  await expect(page.getByLabel("Cost in today's money (USD)")).toHaveValue('20000.00');
});
