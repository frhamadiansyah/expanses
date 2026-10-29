import { expect, test } from '@playwright/test';
import { openGoalForm, pickGoalCurrency } from './goals';
import { goalRow } from './set-aside';

/*
 * A goal counted in a currency of its own: a currency code on the cost row of the New goal page, the amount rows read in that
 * currency, and the saved goal shows its cost in it (EUR with cents, JPY with none).
 */

test('a goal is added in euros: the amount rows name the currency and the list shows euros', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Holiday');
  await page.getByLabel('Name', { exact: true }).fill('Leather bag');
  await expect(page.getByLabel(/Cost today/).first()).toBeVisible();

  await pickGoalCurrency(page, 'EUR');
  await expect(page.getByLabel("Cost today")).toBeVisible();
  await page.getByLabel("Cost today").fill('1250,50');
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
  await pickGoalCurrency(page, 'JPY');
  await page.getByLabel("Cost today").fill('300000');
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
  await pickGoalCurrency(page, 'USD');
  await page.getByLabel("Cost today").fill('20000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page).toHaveURL(/\/goals$/);

  await goalRow(page, 'Tuition abroad').click();
  await page.getByRole('button', { name: 'More', exact: true }).first().click();
  await page.getByRole('menuitem', { name: /^Edit$/ }).first().click();
  await expect(page.getByRole('button', { name: 'Currency: USD' })).toBeVisible();
  await expect(page.getByLabel("Cost today")).toHaveValue('20.000,00');
});
