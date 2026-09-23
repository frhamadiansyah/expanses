import { expect, type Page } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
export const TODAY = local(now);
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
export const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));

/** Every figure a digit at a time, the way a person types it. */
const type = (page: Page, label: string | RegExp, value: string) => page.getByLabel(label, { exact: typeof label === 'string' }).pressSequentially(value);

/**
 * One debt of each kind, so the Debts page has all three groups:
 *
 * - Loans: a mortgage through the debt picker (Rp 712.500.000) and a dollar loan on Accounts (US$1.000,00 at
 *   16.250 = Rp 16.250.000) — Rp 728.750.000;
 * - Credit cards: a card billed Rp 2.000.000 last statement with Rp 450.000 bought since — Rp 2.450.000, the
 *   whole of what is not yet paid;
 * - You owe people: Rp 750.000 borrowed from Dewi through the debt picker.
 *
 * Rp 731.950.000 in all. No rate is fetched: the dollar rate is the one typed.
 */
export async function oneOfEach(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());

  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Home mortgage' }).click();
  await type(page, 'Name', 'KPR BCA');
  await type(page, 'Owed now', '712500000');
  await type(page, 'Lender', 'BCA');
  await type(page, 'Interest rate', '9');
  await type(page, 'Months left', '180');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);

  await openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '1000.00', rate: '16250' });

  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await type(page, 'Billing date', '31');
  await type(page, 'Due date', '15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  for (const [description, amount, date] of [
    ['Hotel Mulia', '2000000', LAST_MONTH],
    ['Superindo', '450000', TODAY],
  ] as const) {
    await page.goto('/transactions');
    await addTransaction(page, { description, paidWith: 'BCA Visa', category: 'Groceries', amount, date, keyByKey: true });
  }

  await page.goto('/debts/new');
  await page.getByRole('button', { name: /^Affiliate debt/ }).click();
  await type(page, 'Owed now', '750000');
  await type(page, 'Who', 'Dewi');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
}

/** The digits of a figure, as a number: `Rp 731.950.000` → 731950000. */
export const digits = (text: string) => Number(text.replace(/[^\d]/g, ''));
