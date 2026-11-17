import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, addTransaction, choosePayment, openAmount, saveButton } from './add-transaction';

/*
 * Cashback into a credit card (owner, 17 Nov 2026): typed as a refund — Expense, minus first, Into the card — under
 * Cashback & Rewards, which Select category offers at the top only then. It lowers total spending, never income, and
 * Groceries keeps its full amount. Invented figures: Rp 320.000 at the supermarket and a Rp 75.000 promo cashback on
 * BCA Visa.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

async function typeAmount(page: Page, keys: string | readonly string[]) {
  const keypad = page.getByTestId('keypad');
  for (const key of keys) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
}

test('cashback into a credit card is Cashback & Rewards: total spent drops, Groceries stays whole, the receipt says it lowers spending', async ({ page }) => {
  await openAccount(page, { subtype: 'credit_card', name: 'BCA Visa' });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Supermarket', paidWith: 'BCA Visa', category: 'Groceries', amount: '320000' });

  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await typeAmount(page, ['−', ...'75000']);
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveText('−75.000');
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(page, 'BCA Visa', 'Into');
  // No line under the amount, for a refund or for cashback.
  await expect(page.getByTestId('refund-caption')).toHaveCount(0);

  await form.getByRole('button', { name: /^Category/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Select category' });
  const cashback = sheet.getByTestId('category-card-cashback');
  // At the top of the Expense list, on its own and with nothing under its name.
  await expect(cashback).toHaveText('Cashback & Rewards');
  const first = await sheet.locator('button').filter({ hasText: /Cashback & Rewards|Household/ }).first().textContent();
  expect(first).toBe('Cashback & Rewards');
  await cashback.click();
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Cashback & Rewards');
  await form.getByLabel('Note').fill('Promo cashback');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // The row: Cashback & Rewards, money in, in green, with no refund arrow.
  const promo = row(page, 'Promo cashback');
  await expect(promo).toContainText('Cashback & Rewards');
  await expect(promo).toContainText('+Rp');
  await expect(promo).toContainText('75.000');
  await expect(promo).not.toContainText('Refund');

  // Total spent is purchases less cashback; Household (Groceries) keeps its full Rp 320.000 and is the whole ring.
  const report = page.getByTestId('spending-report');
  await expect(report.getByTestId('period-total')).toContainText('245.000');
  await expect(report).not.toContainText(/after .* cashback/i);
  await report.getByTestId('see-categories').click();
  const rows = report.getByTestId('report-row');
  await expect(rows.filter({ hasText: 'Household' })).toContainText('320.000');
  await expect(rows.filter({ hasText: 'Household' })).toContainText('100%');
  await expect(rows.filter({ hasText: 'Cashback & Rewards' })).toContainText('75.000');
  // Income is untouched: nothing was earned.
  await page.getByRole('radio', { name: 'Income' }).first().click();
  await expect(report.getByTestId('period-total')).toContainText('0');
  await expect(report).not.toContainText('Cashback & Rewards');
  await page.getByRole('radio', { name: 'Expense' }).first().click();

  // The receipt names it and says what it does: no "Refund".
  await promo.getByRole('button', { name: /^Cashback & Rewards Promo cashback/ }).click();
  await expect(page.getByTestId('receipt-hero')).toContainText('Cashback & Rewards');
  await expect(page.getByText('Lowers spending')).toBeVisible();
  await expect(page.getByText('Money back')).toHaveCount(0);
});

test('Cashback & Rewards is offered only for money back into a credit card, and moving Into to a bank takes it away', async ({ page }) => {
  await openAccount(page, { subtype: 'credit_card', name: 'BCA Visa' });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');

  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  const sheet = page.getByRole('dialog', { name: 'Select category' });
  // A purchase on the card: not offered.
  await openAmount(form);
  await typeAmount(page, '75000');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Visa');
  await form.getByRole('button', { name: /^Category/ }).click();
  await expect(sheet.getByRole('button', { name: 'Household', exact: true })).toBeVisible();
  await expect(sheet.getByTestId('category-card-cashback')).toHaveCount(0);
  await expect(sheet.getByText('Cashback & Rewards')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();

  // Money back into the card: offered, and chosen.
  await openAmount(form);
  await typeAmount(page, ['C', '−', ...'75000']);
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveText('−75.000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await sheet.getByTestId('category-card-cashback').click();
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Cashback & Rewards');

  // Into a bank it would be income instead: the category is taken away, never left wrong.
  await form.getByRole('button', { name: /^Into/ }).click();
  await page.getByRole('dialog', { name: 'Into' }).getByRole('radio', { name: 'Accounts' }).click();
  await choosePayment(page, 'BCA Tahapan', 'Into');
  await expect(form.getByRole('button', { name: /^Category/ })).not.toContainText('Cashback & Rewards');
  await form.getByRole('button', { name: /^Category/ }).click();
  await expect(sheet.getByTestId('category-card-cashback')).toHaveCount(0);
});
