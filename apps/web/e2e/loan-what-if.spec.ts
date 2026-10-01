import { expect, test } from '@playwright/test';
import { openAccount, openLoan } from './accounts';

const digits = (text: string) => Number(text.replace(/[^\d]/g, ''));

/** The what-if lives inside Pay extra: an amount typed is interest saved and an earlier finish, before anything is written. */
test('an extra amount shows the interest it saves and how much sooner the loan finishes', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '900000000' });
  await openLoan(page, { kind: 'Home mortgage', name: 'KPR BTN', owed: '616000000', lender: 'BTN', interestRate: '7.5', months: '180' });
  await page.getByText('KPR BTN', { exact: true }).first().click();
  const end = await page.getByTestId('loan-end').innerText();

  await page.getByRole('button', { name: 'Pay extra', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay extra' });
  await expect(sheet.getByTestId('what-if')).toHaveCount(0);
  await sheet.getByLabel(/How much/).fill('50000000');

  const saved = sheet.getByTestId('what-if-saved');
  await expect(saved).toContainText(/Interest saved\s*Rp/);
  const once = digits(await saved.innerText());
  expect(once).toBeGreaterThan(0);
  const finish = sheet.getByTestId('what-if-finish');
  await expect(finish).toContainText(/Finishes\s*[A-Z][a-z]{2} \d{4} \(.*sooner\)/);
  expect(await finish.innerText()).not.toContain(end.replace('Pays off ', ''));

  // Every year saves more than once.
  await sheet.getByLabel('How often').selectOption('yearly');
  await expect.poll(async () => digits(await saved.innerText())).toBeGreaterThan(once);

  // Lower payment keeps the end and names the new payment instead.
  await sheet.getByLabel('How often').selectOption('once');
  await sheet.getByLabel('Then').selectOption('tenor');
  await expect(sheet.getByTestId('what-if-payment')).toContainText(/New payment\s*Rp/);
  await expect(finish).toHaveCount(0);

  // The ⓘ says what is recorded, without asking anything of the reader.
  await sheet.getByRole('button', { name: 'About Interest saved' }).click();
  await expect(sheet).toContainText('Saving records this one extra payment only');

  // Nothing was written by asking.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('card-figure')).toContainText('616.000.000');
});
