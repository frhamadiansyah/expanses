import { expect, type Page } from '@playwright/test';
import { openAccount, openCard, openLoan } from './accounts';
import { addTransaction } from './add-transaction';

/**
 * The Debt-free plan's journeys, on invented figures:
 *
 * - `seedPlan`: on 11 Nov 2026, a bank account; a mortgage through the debt picker (Rp 28.400.000 at 7,5% over 120
 *   months, lender BCA); BCA Visa billed on the 31st and due on the 18th, with Rp 6.214.300 bought on 20 Oct (billed
 *   on the October statement, due 18 Nov); and Rp 850.000 borrowed from Dewi. Rp 35.464.300 in all.
 * - `seedLatePaylater`: a paylater opened on 1 Oct 2026 (Rp 6.000.000, 2% a month, 6 months, first instalment
 *   1 Nov), with the clock moved on to 4 Nov — the first instalment three days late.
 */

export const at = (day: string) => new Date(`${day}T12:00:00`);

export async function bank(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
}

export async function owedTo(page: Page, who: string, amount: string) {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: /^Affiliate debt/ }).click();
  await page.getByLabel('Owed now').fill(amount);
  await page.getByLabel('Who').fill(who);
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
}

export async function seedPlan(page: Page) {
  await page.clock.setSystemTime(at('2026-11-11'));
  await bank(page);
  await openLoan(page, { kind: 'Home mortgage', name: 'KPR BCA', owed: '28400000', lender: 'BCA', interestRate: '7.5', months: '120' });
  await openCard(page, { name: 'BCA Visa', statementDay: '31', dueDay: '18' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Hotel Mulia', paidWith: 'BCA Visa', category: 'Groceries', amount: '6214300', date: '2026-10-20', keyByKey: true });
  await owedTo(page, 'Dewi', '850000');
}

/** A paylater through the debt picker, whose rate is typed a month. */
export async function openPaylater(page: Page, o: { name: string; owed: string; perMonth: string; months: string }) {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Online loan or paylater' }).click();
  await page.getByLabel('Name', { exact: true }).fill(o.name);
  await page.getByLabel('Owed now').fill(o.owed);
  await page.getByLabel('Lender').fill(o.name);
  await page.getByLabel('Interest a month').fill(o.perMonth);
  await page.getByLabel('Months left').fill(o.months);
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);
}

export async function seedLatePaylater(page: Page) {
  await page.clock.setSystemTime(at('2026-10-01'));
  await bank(page);
  await openPaylater(page, { name: 'Kredit', owed: '6000000', perMonth: '2', months: '6' });
  await page.clock.setSystemTime(at('2026-11-04'));
}

/** The Pay first rows' names, in order. */
export async function planRows(page: Page): Promise<string[]> {
  const rows = page.getByTestId('pay-first-row');
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-name') ?? ''));
}
