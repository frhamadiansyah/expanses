import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page, name: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** Bills are set up on their own screen; day 1, so the day has always passed by the time a test looks. */
async function addBill(page: Page, options: { name: string; amount?: string; day?: string }) {
  await page.goto('/bills');
  await page.getByRole('button', { name: 'Add a bill' }).click();
  await page.getByLabel('What is it').fill(options.name);
  await page.getByLabel('Day of the month').fill(options.day ?? '1');
  // Whichever category is first: the point is the bill, not which category it lands in.
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  if (options.amount !== undefined) await page.getByLabel('Amount', { exact: true }).fill(options.amount);
  await page.getByRole('button', { name: 'Save bill' }).click();
  // A second bill means a second row, so look for this one rather than for the only one.
  await expect(page.getByTestId('bill-row').filter({ hasText: options.name })).toBeVisible();
}

/** Opens the recurring sheet from the card above the transactions. Kept for the skipped sheet tests below. */
async function openRecurring(page: Page) {
  await page.goto('/transactions');
  await page.getByTestId('recurring-card').click();
  return page.getByTestId('recurring-sheet');
}

test('the Cashflow card counts the month’s bills', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  // The card counts it before anything is done about it.
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('0 of 1 bill paid');
  await expect(page.getByTestId('recurring-card')).toContainText('150.000');
});

// Rewritten against the Recurring screen in Task 9.
test.skip('a bill whose day has passed is owed, and recording it settles the month', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  // The card counts it before anything is done about it.
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('0 of 1 bill paid');
  await expect(page.getByTestId('recurring-card')).toContainText('150.000');

  const sheet = await openRecurring(page);
  await expect(sheet).toContainText('Owed now');
  await sheet.getByLabel('Pay Phone').check();
  await sheet.getByRole('button', { name: /^Record/ }).click();

  // Settled: it moves to what is already paid, and the payment is in the list.
  await expect(sheet).toContainText('Already paid');
  await expect(sheet.getByLabel('Pay Phone')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('recurring-card')).toContainText('1 of 1 bill paid');
  await expect(page.getByRole('listitem').filter({ hasText: 'Phone' }).first()).toBeVisible();
});

// Rewritten against the Recurring screen in Task 9.
test.skip('several bills are recorded together, on the day they were paid', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });

  const sheet = await openRecurring(page);
  await sheet.getByLabel('Pay Phone').check();
  await sheet.getByLabel('Pay Internet').check();
  // One date for the lot: they were paid two days ago, not today.
  const paidOn = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await sheet.getByLabel('Paid on').fill(paidOn);
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();

  await expect(sheet.getByLabel('Pay Phone')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('recurring-card')).toContainText('2 of 2 bills paid');
});

// Rewritten against the Recurring screen in Task 9.
test.skip('a bill that differs every month asks what it came to', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Electricity' });

  const sheet = await openRecurring(page);
  // No amount was set, so none is shown as though it were known.
  await expect(sheet).toContainText('Electricity');
  await expect(sheet).not.toContainText('150.000');

  await sheet.getByLabel('Pay Electricity').check();
  await sheet.getByLabel('What Electricity came to').fill('432000');
  await sheet.getByRole('button', { name: /^Record/ }).click();

  await expect(sheet).toContainText('Already paid');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '432.000' }).first()).toBeVisible();
});

// Rewritten against the Recurring screen in Task 9.
test.skip('a month can be skipped, and stops being owed', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Fitness First', amount: '850000' });

  const sheet = await openRecurring(page);
  await sheet.getByRole('button', { name: 'Skip' }).click();

  await expect(sheet).toContainText('skipped this month');
  await expect(sheet).not.toContainText('Owed now');
  await page.getByRole('button', { name: 'Close' }).click();
  // A skipped bill counts as settled: the month is done with it.
  await expect(page.getByTestId('recurring-card')).toContainText('1 of 1 bill paid');
});

// Rewritten against the Recurring screen in Task 9.
test.skip('a bill whose day has not come round is listed as still to come', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  // The 31st has not passed in any month this test can run in, except on the 31st itself.
  await addBill(page, { name: 'Housing rent', amount: '5000000', day: '31' });

  const sheet = await openRecurring(page);
  if (new Date().getDate() < 31) {
    await expect(sheet).toContainText('Later this month');
    await expect(sheet).not.toContainText('Owed now');
  }
});
