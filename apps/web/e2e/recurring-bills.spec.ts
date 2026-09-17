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

/** Bills are set up on their own page. Out on the 1st unless told otherwise, so the bill is always out. */
async function addBill(page: Page, options: { name: string; amount?: string; out?: number; payBy?: number }) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(options.name);
  if (options.amount !== undefined) await page.getByLabel('Amount', { exact: true }).fill(options.amount);
  // Whichever category is first: the point is the bill, not which category it lands in.
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Bill is out on').selectOption(String(options.out ?? 1));
  if (options.payBy !== undefined) await page.getByLabel('Pay by').selectOption(String(options.payBy));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
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

test('a bill keeps its pay-by day through an edit', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 28, payBy: 5 });
  await page.getByTestId('bill-row').filter({ hasText: 'Biznet Home' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByLabel('Bill is out on')).toHaveValue('28');
  await expect(page.getByLabel('Pay by')).toHaveValue('5');
  await page.getByLabel('Pay by').selectOption('');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('bill-row').filter({ hasText: 'Biznet Home' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Pay by')).toHaveValue('');
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
  await addBill(page, { name: 'Housing rent', amount: '5000000', out: 31 });

  const sheet = await openRecurring(page);
  if (new Date().getDate() < 31) {
    await expect(sheet).toContainText('Later this month');
    await expect(sheet).not.toContainText('Owed now');
  }
});
