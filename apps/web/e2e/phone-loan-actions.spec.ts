import { expect, test } from '@playwright/test';
import { openAccount, openLoan } from './accounts';

test('by thumb: a loan’s four round actions each open their sheet, and ⋯ holds the terms and the tax code', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '900000000' });
  await openLoan(page, { kind: 'Home mortgage', name: 'KPR BTN', owed: '616000000', lender: 'BTN', interestRate: '7.5', months: '180' });
  await page.getByText('KPR BTN', { exact: true }).first().tap();
  await expect(page.getByTestId('loan-line')).toContainText('BTN · 7,5% fixed · Home mortgage');
  await expect(page.getByTestId('loan-end')).toContainText(/Pays off [A-Z][a-z]{2} \d{4}/);

  for (const [action, title, save] of [
    ['Pay', 'Pay', 'Save payment'],
    ['Pay extra', 'Pay extra', 'Save extra payment'],
    ['Rate change', 'Rate change', 'Save rate change'],
    ['Pay off', 'Pay off', 'Record pay off'],
  ] as const) {
    await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: action, exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: title });
    await expect(sheet.getByRole('button', { name: save })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).tap();
    await expect(sheet).toHaveCount(0);
  }

  // The instalment by thumb: the sheet fills itself in, and the payment lands under Payments.
  await page.getByRole('button', { name: 'Pay', exact: true }).tap();
  await page.getByRole('dialog', { name: 'Pay' }).getByRole('button', { name: 'Save payment' }).tap();
  await expect(page.getByTestId('loan-payment')).toHaveCount(1);
  await expect(page.getByTestId('loan-payment')).toContainText('principal');

  // The month-by-month schedule is a sheet behind the Next payment group.
  await page.getByRole('button', { name: 'Schedule' }).tap();
  await expect(page.getByRole('dialog', { name: 'Schedule' })).toContainText('What is still to come');
  await page.getByRole('dialog', { name: 'Schedule' }).getByRole('button', { name: 'Close' }).tap();

  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await expect(page.getByRole('menuitem', { name: 'Edit terms' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Tax report code' }).tap();
  await expect(page.getByRole('dialog', { name: 'Tax report code' }).getByLabel('Tax report code', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
