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

/** Day 1, so the day has always passed by the time the test looks. */
async function addBill(page: Page, options: { name: string; amount?: string }) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add a bill' }).click();
  await page.getByLabel('What is it').fill(options.name);
  await page.getByLabel('Day of the month').fill('1');
  // Whichever category is first: the point is the bill, not which category it lands in.
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  if (options.amount !== undefined) await page.getByLabel('Amount', { exact: true }).fill(options.amount);
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByTestId('bill-row')).toContainText(options.name);
}

test('a bill whose day has passed is offered, and recording it settles the month', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  const due = page.getByTestId('bills-due');
  await expect(due).toContainText('Phone');
  await expect(due).toContainText('150.000');

  await due.getByRole('button', { name: 'Record it' }).click();

  // Settled: it stops being asked for, and the payment is in the list.
  await expect(page.getByTestId('bills-due')).toHaveCount(0);
  // Scoped to the list: a hidden <option> in the category filter also reads "Phone".
  await expect(page.getByRole('listitem').filter({ hasText: 'Phone' }).first()).toBeVisible();
});

test('a bill that differs every month asks what it came to', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Electricity' });

  const due = page.getByTestId('bills-due');
  await expect(due).toContainText('Electricity');
  // No amount was set, so none is shown as though it were known.
  await expect(due).not.toContainText('150.000');

  await due.getByLabel('Amount for Electricity').fill('432000');
  await due.getByRole('button', { name: 'Record it' }).click();

  await expect(page.getByTestId('bills-due')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: '432.000' }).first()).toBeVisible();
});

test('a bill is only offered once its day has come round', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add a bill' }).click();
  await page.getByLabel('What is it').fill('Housing rent');
  // The 31st has not passed in any month this test can run in, except on the 31st itself.
  await page.getByLabel('Day of the month').fill('31');
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Amount', { exact: true }).fill('5000000');
  await page.getByRole('button', { name: 'Save bill' }).click();

  await expect(page.getByTestId('bill-row')).toContainText('Housing rent');
  if (new Date().getDate() < 31) await expect(page.getByTestId('bills-due')).toHaveCount(0);
});
