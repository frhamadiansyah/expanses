import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { mockRates } from './pockets';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const row = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

/** A life cover bill of SGD 120, paid from a rupiah account, with the day's SGD rate on the device. */
async function lifeCover(page: Page) {
  await mockRates(page, { SGD: 12_500 });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  // An SGD account stores the day's rate, which is what the pay sheet estimates from; the bill is never paid from it.
  await openAccount(page, { subtype: 'bank', name: 'Wise SGD', balance: '1000', currency: 'SGD', rate: '12500' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Life cover');
  await pickBillPaidFrom(page, 'BCA Tahapan');
  // Out today, so the rate stored today reaches it.
  // The row defaults to the paying account's currency.
  await expect(page.getByRole('button', { name: /^Currency\s*IDR/ })).toBeVisible();
  await page.getByRole('button', { name: /^Currency\s*[A-Z]{3}/ }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: /^SGD / }).first().click();
  await page.getByLabel('Amount', { exact: true }).fill('120');
  await pickBillCategory(page);
  await page.getByLabel('Bill date').selectOption(String(Number((await todayIn(page)).slice(8))));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

test('an SGD bill paid from a rupiah account: written in SGD, charged in rupiah', async ({ page }) => {
  await lifeCover(page);

  // The row says what the bill costs in its own money.
  await expect(row(page, 'Life cover')).toContainText(/120[.,]00/);
  await expect(row(page, 'Life cover')).not.toContainText('Rp');

  // The Cashflow card counts it in the money the workspace reads in, at the stored rate: 120 × 12 500.
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('1.500.000');

  // Pay from Recurring: the sheet shows the SGD figure and asks what the account was charged, estimated at the rate.
  await page.goto('/bills');
  // Paid, the row folds away with the month's other settled bills: keep the bill's own page to come back to.
  await row(page, 'Life cover').click();
  const billPage = page.url();
  await page.goto('/bills');
  await row(page, 'Life cover').hover();
  await page.getByRole('button', { name: 'Actions for Life cover' }).click();
  await page.getByRole('menuitem', { name: /^Pay/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay Life cover' });
  await expect(sheet.getByText('Amount', { exact: true })).toBeVisible();
  await expect(sheet.getByText('SGD', { exact: true }).first()).toBeVisible();
  await expect(sheet.getByLabel('What it came to')).toHaveValue(/^120([.,]00)?$/);
  const charged = sheet.getByLabel('Charged in IDR', { exact: true });
  await expect(charged).toHaveValue(/^1[.,]?500[.,]?000/);

  // What the bank really took is typed over the estimate.
  await charged.fill('1510000');
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toHaveCount(0);

  // The transaction carries the rupiah charged, with the SGD original beside it.
  await page.goto('/transactions');
  const tx = page.getByText('Life cover').first();
  await expect(tx).toBeVisible();
  const line = page.locator('li, tr, [role="row"], [data-testid]').filter({ hasText: 'Life cover' }).filter({ hasText: /1\.510\.000/ }).first();
  await expect(line).toContainText(/120[.,]00/);

  // The bill's history says both.
  await page.goto(billPage);
  await expect(page.getByTestId('bill-history')).toContainText(/120[.,]00.*charged.*1\.510\.000/);
});

test('Pay several asks what the account was charged for an SGD bill, and records it', async ({ page }) => {
  await lifeCover(page);
  await page.goto('/bills');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Life cover' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 1 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  const charged = sheet.getByLabel('Charged in IDR for Life cover');
  await expect(charged).toHaveValue(/^1[.,]?500[.,]?000/);
  await charged.fill('');
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(sheet).toContainText('Enter what the account was charged in IDR for Life cover');
  await charged.fill('1512000');
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/transactions');
  const line = page.locator('li, tr, [role="row"], [data-testid]').filter({ hasText: 'Life cover' }).filter({ hasText: /1\.512\.000/ }).first();
  await expect(line).toContainText(/120[.,]00/);
});

test('Pay several with another account: the SGD bill is charged in that account\'s money', async ({ page }) => {
  await lifeCover(page);
  await openAccount(page, { subtype: 'bank', name: 'Jenius', balance: '20000000' });
  await page.goto('/bills');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Life cover' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 1 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await sheet.getByTestId('several-with').getByRole('button').click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /Jenius/ }).click();
  await expect(sheet.getByTestId('several-with')).toContainText('Jenius');
  const charged = sheet.getByLabel('Charged in IDR for Life cover');
  await expect(charged).toHaveValue(/^1[.,]?500[.,]?000/);
  await charged.fill('1512000');
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/transactions');
  const line = page.locator('li, tr, [role="row"], [data-testid]').filter({ hasText: 'Life cover' }).filter({ hasText: /1\.512\.000/ }).first();
  await expect(line).toContainText(/120[.,]00/);
});

test('an SGD bill keeps its currency through an edit, and a bill with none follows its payer', async ({ page }) => {
  await lifeCover(page);
  await row(page, 'Life cover').click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: /^Currency\s*SGD/ })).toBeVisible();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue(/^120([.,]00)?$/);
  await page.getByLabel('Amount', { exact: true }).fill('125');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: /^Currency\s*SGD/ })).toBeVisible();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue(/^125([.,]00)?$/);

  // A new bill with a payer chosen reads in that payer's currency until another is picked.
  await page.goto('/bills/new');
  await pickBillPaidFrom(page, 'Wise SGD');
  await expect(page.getByRole('button', { name: /^Currency\s*SGD/ })).toBeVisible();
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await expect(page.getByRole('button', { name: /^Currency\s*IDR/ })).toBeVisible();
});
