import { expect, test } from '@playwright/test';
import { openAccount, openLoan, openTypes } from './accounts';

/**
 * Pay off, from the loan's own page: everything still owed and the bank's early-settlement fee in one payment. The
 * loan is cleared and waits under the paid-off loans, the fee is booked as a fee beside the principal, and the account
 * it was paid from falls by the two together.
 */
test('a loan paid off with a fee is cleared, books the fee, and takes the total from the account', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '900000000' });
  await openLoan(page, { kind: 'Home mortgage', name: 'KPR BTN', owed: '616000000', lender: 'BTN', interestRate: '7.5', months: '180' });
  await page.getByText('KPR BTN', { exact: true }).first().click();
  await expect(page.getByTestId('loan-card')).toContainText('616.000.000');

  await page.getByRole('button', { name: 'Pay off', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay off' });
  await expect(sheet.getByTestId('pay-off-owed')).toContainText('616.000.000');
  // A fee as a share of what is owed first: 1% of 616.000.000.
  await sheet.getByLabel('Early settlement fee').fill('1');
  await sheet.getByRole('button', { name: '%', exact: true }).click();
  await expect(sheet.getByTestId('pay-off-fee')).toContainText('6.160.000');
  await expect(sheet.getByTestId('pay-off-total')).toContainText('622.160.000');
  // Then as a sum, which is what is saved.
  await sheet.getByRole('button', { name: '%', exact: true }).click();
  await sheet.getByLabel('Early settlement fee').fill('2500000');
  await expect(sheet.getByTestId('pay-off-total')).toContainText('618.500.000');
  await sheet.getByRole('button', { name: 'Record pay off' }).click();
  await expect(sheet).toHaveCount(0);

  // Nothing is owed, the page says when it was paid off, and there is nothing left to pay.
  await expect(page.getByTestId('card-figure')).toContainText('Rp 0');
  await expect(page.getByTestId('loan-end')).toContainText('Paid off');
  await expect(page.getByTestId('loan-repaid')).toHaveText('100% repaid');
  await expect(page.getByRole('button', { name: 'Pay off', exact: true })).toHaveCount(0);
  // The payment's own line: the principal, and the fee as a fee beside it.
  const payment = page.getByTestId('loan-payment').first();
  await expect(payment).toContainText('616.000.000 principal');
  await expect(payment).toContainText(/2\.500\.000 fees/);
  await expect(payment).toContainText('618.500.000');

  // Liabilities lists it under the paid-off loans, out of the total.
  await page.goto('/net-worth/loans');
  await expect(page.getByTestId('debts-total')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show paid-off loans (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Paid off' })).toBeVisible();

  // The account paid both: 900.000.000 − 616.000.000 − 2.500.000.
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'BCA Tahapan', exact: true }) })).toContainText('281.500.000');
});
