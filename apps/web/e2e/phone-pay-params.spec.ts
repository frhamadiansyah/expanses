import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, openLoan } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { openLoan as openPersonLoan } from './people';

/**
 * The Debt-free plan's Pay buttons land on a debt's own page with one search param that opens that page's existing
 * pay sheet. Closing it (Save or Cancel) goes back to the page Pay was tapped on; a plain visit opens nothing.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Lands on `from`, then on `to`: the sheet opens, its ✕ goes back to `from`. */
async function opensAndGoesBack(page: Page, from: string, to: string, sheet: string, button?: string) {
  await page.goto(from);
  await page.goto(to);
  const dialog = page.getByRole('dialog', { name: sheet });
  await expect(button ? dialog.getByRole('button', { name: button }) : dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(new RegExp(`${from.replace(/[?]/g, '\\?')}$`));
}

/** A plain visit: the page, and no sheet over it. */
async function opensNothing(page: Page, to: string, sheet: string) {
  await page.goto(to);
  await expect(page.getByRole('main')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: sheet })).toHaveCount(0);
}

test('a loan opens Pay or Pay extra from its link, and goes back after', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await openLoan(page, { kind: 'Online loan or paylater', name: 'Kredit', owed: '6000000', lender: 'Kredit', months: '6' });
  const testId = await page.locator('[data-testid^="debt-row-"]').filter({ hasText: 'Kredit' }).first().getAttribute('data-testid');
  const id = testId!.replace('debt-row-', '');

  await opensAndGoesBack(page, '/net-worth/loans', `/net-worth/loans/${id}?pay=due`, 'Pay', 'Save payment');
  await opensAndGoesBack(page, '/net-worth/loans', `/net-worth/loans/${id}?pay=extra`, 'Pay extra', 'Save extra payment');
  await opensNothing(page, `/net-worth/loans/${id}`, 'Pay');
});

test('a card opens its pay sheet from its link, and goes back after', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await openCard(page, { name: 'BCA Visa', owed: '1500000' });
  const id = new URL(page.url()).pathname.split('/').at(-1)!;

  await opensAndGoesBack(page, '/net-worth/loans', `/cards/${id}?pay=1`, 'Pay BCA Visa');
  await opensNothing(page, `/cards/${id}`, 'Pay BCA Visa');
});

test('a bill opens its pay sheet from its link, and goes back after', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Electricity');
  await page.getByLabel('Amount', { exact: true }).fill('450000');
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Bill date').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await page.getByTestId('bill-row').filter({ hasText: 'Electricity' }).first().getByText('Electricity').click();
  await expect(page).toHaveURL(/\/bills\/[^/?]+/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;

  await opensAndGoesBack(page, '/bills', `/bills/${id}?pay=1`, 'Pay Electricity');
  await opensNothing(page, `/bills/${id}`, 'Pay Electricity');
});

test('a Lend & borrow loan opens its repayment form from its link, and goes back after', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/debts/new');
  await page.getByRole('button', { name: /^Affiliate debt/ }).click();
  await page.getByLabel('Owed now').fill('850000');
  await page.getByLabel('Who').fill('Dewi');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  // Opened for Dewi, the list is on the side she is on (the phone opens on Receivables otherwise).
  await page.goto('/net-worth/lend-borrow?person=Dewi');
  await openPersonLoan(page, 'Dewi');
  const id = new URL(page.url()).pathname.split('/').at(-1)!;

  await opensAndGoesBack(page, '/net-worth/lend-borrow', `/net-worth/lend-borrow/loan/${id}?repay=1`, 'Repayment', 'Save repayment');
  await opensNothing(page, `/net-worth/lend-borrow/loan/${id}`, 'Repayment');
});
