/** Shared walks for the pause specs: a household with two bills, and pausing one from its own page. */
import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';

/** A bill out on the 1st, so it is always out this month. */
export async function addBill(page: Page, name: string, amount: string, category: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('Category').selectOption({ label: category });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Bill is out on').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bill-row').filter({ hasText: name })).toBeVisible();
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Pauses a bill from its own page for a number of months. */
export async function pauseFor(page: Page, name: string, months: 1 | 2 | 3 | 6) {
  await page.getByTestId('bill-row').filter({ hasText: name }).click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pause' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pause' });
  await sheet.getByRole('radio', { name: months === 1 ? '1 month' : `${months} months` }).click();
  await sheet.getByRole('button', { name: `Pause ${name}` }).click();
  await expect(sheet).toHaveCount(0);
}

export async function household(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await addBill(page, 'Gym', '350000', 'Sports & fitness');
  await addBill(page, 'Phone', '150000', 'Mobile phone');
}

