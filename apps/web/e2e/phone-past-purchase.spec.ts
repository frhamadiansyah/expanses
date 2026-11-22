import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccount, openSettings, openWalletAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';

/*
 * Past purchases: an old expense on a money account starts out as "past" by itself when it is dated before the day the
 * account's balance is counted from, and then leaves the balance as it is. Today is pinned to 20 September 2026 and the
 * account is opened that day. Every name and figure is invented.
 */
const TODAY = new Date('2026-09-20T12:00:00');

test.beforeEach(async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet Satu', balance: '500000' });
  await page.goto('/transactions');
});

async function fillExpense(page: Page, date: string, note = 'Noodle Stall') {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '41000');
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'Dompet Satu');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill(note);
  await form.getByLabel('Date').fill(date);
  return form;
}

test('an expense dated before the account opened is ticked past by itself, and the balance stays', async ({ page }) => {
  const form = await fillExpense(page, '2026-09-10');
  const past = form.getByRole('button', { name: 'Past purchase' });
  await expect(past).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByTestId('past-tick')).toBeVisible();
  await page.screenshot({ path: 'test-results/past-form-ticked.png' });
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Satu', '500.000');

  // The receipt says so, and the expense still counts in the month it was made.
  await page.goto('/transactions?month=2026-09');
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Noodle Stall' });
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Settled before the app' })).toHaveCount(0);
  await row.click();
  await expect(page.getByTestId('receipt-past')).toContainText('Balance unchanged');
  await page.screenshot({ path: 'test-results/past-receipt.png' });
});

test('untick it and the balance counts the expense', async ({ page }) => {
  const form = await fillExpense(page, '2026-09-10');
  const past = form.getByRole('button', { name: 'Past purchase' });
  await expect(past).toHaveAttribute('aria-pressed', 'true');
  await past.click();
  await expect(past).toHaveAttribute('aria-pressed', 'false');
  await expect(form.getByTestId('past-tick')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/past-form-unticked.png' });
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Satu', '459.000');
});

test('an expense dated on the opening day is an ordinary one, and a tap can still make it past', async ({ page }) => {
  const form = await fillExpense(page, '2026-09-20');
  const past = form.getByRole('button', { name: 'Past purchase' });
  await expect(past).toHaveAttribute('aria-pressed', 'false');
  await expect(form.getByTestId('past-tick')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/past-form-normal.png' });
  // Changing the date re-decides it until it is touched.
  await form.getByLabel('Date').fill('2026-09-01');
  await expect(past).toHaveAttribute('aria-pressed', 'true');
  await form.getByLabel('Date').fill('2026-09-20');
  await expect(past).toHaveAttribute('aria-pressed', 'false');
  await past.click();
  await expect(past).toHaveAttribute('aria-pressed', 'true');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Satu', '500.000');
});

test('a saved past purchase opens ticked, and unticking it on edit moves the balance by its amount', async ({ page }) => {
  const form = await fillExpense(page, '2026-09-10');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/transactions?month=2026-09');
  await page.getByTestId('transaction-row').filter({ hasText: 'Noodle Stall' }).click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('form').or(page.getByRole('dialog')).filter({ has: page.getByRole('button', { name: 'Past purchase' }) }).first();
  const past = edit.getByRole('button', { name: 'Past purchase' });
  await expect(past).toHaveAttribute('aria-pressed', 'true');
  await past.click();
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Satu', '459.000');
});

test('the account settings show the day its balance is counted from, and moving it rewrites nothing', async ({ page }) => {
  const form = await fillExpense(page, '2026-09-10');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await openWalletAccount(page, 'Dompet Satu');
  await openSettings(page);
  const asOf = page.getByLabel('As of');
  await expect(asOf).toHaveValue('2026-09-20');
  await page.screenshot({ path: 'test-results/past-settings.png' });
  await asOf.fill('2026-09-05');
  await asOf.blur();
  await page.goto('/wallet');
  // Nothing already recorded is recounted.
  await expectWalletFigure(page, 'Dompet Satu', '500.000');
  await page.goto('/transactions?month=2026-09');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Noodle Stall' })).toHaveCount(1);
});

test('an account opened at nothing counts from the day it was added', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay Nol', balance: '0' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '41000');
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'GoPay Nol');
  await form.getByLabel('Date').fill('2026-09-10');
  await expect(form.getByRole('button', { name: 'Past purchase' })).toHaveAttribute('aria-pressed', 'true');
  await form.getByLabel('Date').fill('2026-09-20');
  await expect(form.getByRole('button', { name: 'Past purchase' })).toHaveAttribute('aria-pressed', 'false');
});

test('an account opened at nothing shows its As of, and moving it back moves where "past" starts', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay Nol', balance: '0' });
  await openWalletAccount(page, 'GoPay Nol');
  await openSettings(page);
  const asOf = page.getByLabel('As of');
  await expect(asOf).toHaveValue('2026-09-20');
  await expect(page.getByLabel('Balance', { exact: true })).toHaveValue('0');
  await asOf.fill('2026-09-01');
  await asOf.blur();
  await expect(asOf).toHaveValue('2026-09-01');
  // The day is kept, and no opening entry was made for it.
  await page.goto('/wallet');
  await openWalletAccount(page, 'GoPay Nol');
  await openSettings(page);
  await expect(page.getByLabel('As of')).toHaveValue('2026-09-01');
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '41000');
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'GoPay Nol');
  await form.getByLabel('Date').fill('2026-09-10');
  await expect(form.getByRole('button', { name: 'Past purchase' })).toHaveAttribute('aria-pressed', 'false');
  await form.getByLabel('Date').fill('2026-08-20');
  await expect(form.getByRole('button', { name: 'Past purchase' })).toHaveAttribute('aria-pressed', 'true');
});
