import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment } from './add-transaction';

async function openDefault(page: Page) {
  await page.goto('/account');
  await page.getByRole('link', { name: /^Default/ }).click();
  await expect(page.getByRole('heading', { name: 'Default', exact: true })).toBeVisible();
}

/** A row of the Default page, and whether it carries the tick. */
const row = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const ticked = (page: Page, name: string) => row(page, name).getByTestId('default-ticked');

test('the Default Paid with is set from the Account page, saved by the ✓, and opens a new transaction', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await openAccount(page, { subtype: 'bank', name: 'Mandiri Giro' });

  // Nothing chosen yet: the Account row says None and a new transaction opens empty.
  await page.goto('/account');
  await expect(page.getByRole('link', { name: /^Default/ })).toContainText('None');
  await page.goto('/transactions/new');
  const form = addForm(page);
  await expect(form.getByRole('button', { name: 'Payment method' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Payment method' })).not.toContainText('BCA Tahapan');

  // Tapping a row only moves the tick; ‹ leaves with nothing saved.
  await openDefault(page);
  await expect(ticked(page, 'None')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await row(page, 'BCA Tahapan').click();
  await expect(ticked(page, 'BCA Tahapan')).toBeVisible();
  await expect(ticked(page, 'None')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  await page.locator('header').getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('link', { name: /^Default/ })).toContainText('None');

  // The ✓ saves and returns to the Account page.
  await openDefault(page);
  await row(page, 'BCA Tahapan').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('link', { name: /^Default/ })).toContainText('BCA Tahapan');

  // A plain new transaction opens with it chosen.
  await page.goto('/transactions/new');
  await expect(addForm(page).getByRole('button', { name: 'Payment method' })).toContainText('BCA Tahapan');

  // Another account for one purchase changes that purchase only.
  await addForm(page).getByRole('button', { name: 'Payment method' }).click();
  await choosePayment(page, 'Mandiri Giro');
  await expect(addForm(page).getByRole('button', { name: 'Payment method' })).toContainText('Mandiri Giro');
  await page.goto('/transactions/new');
  await expect(addForm(page).getByRole('button', { name: 'Payment method' })).toContainText('BCA Tahapan');
  await openDefault(page);
  await expect(ticked(page, 'BCA Tahapan')).toBeVisible();

  // None again: a new transaction opens empty.
  await row(page, 'None').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('link', { name: /^Default/ })).toContainText('None');
  await page.goto('/transactions/new');
  await expect(addForm(page).getByRole('button', { name: 'Payment method' })).not.toContainText('BCA Tahapan');
});
