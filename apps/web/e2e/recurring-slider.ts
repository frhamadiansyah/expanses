import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { todayIn } from './today';

/** A yearly bill 180 days ahead, so it is only on the Repeating page. Opens the wallet it is paid from. */
export async function addFarYearlyBill(page: Page, name: string) {
  const [y, m, d] = (await todayIn(page)).split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + 180);
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill('3000000');
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption(String(date.getMonth() + 1));
  await page.getByLabel('Due by').selectOption(String(date.getDate()));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

/** A monthly bill out on the 1st, so Monthly has a hero. */
export async function addMonthlyBill(page: Page, name: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill('150000');
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Bill date').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}
