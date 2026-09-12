import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  await page.getByLabel(balanceLabel).fill(amount);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** Onboards a KPR already running: the account holds what is still owed, the terms say on what basis. */
async function addKpr(page: Page, { asset }: { asset?: string } = {}) {
  await page.goto('/net-worth/loans');
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').fill('Bank BTN');
  await page.getByLabel(/Amount borrowed/).fill('700000000');
  await page.getByLabel('Rate a year (%)').fill('9');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').fill('180');
  await page.getByLabel('Payment day').fill('25');
  if (asset) await page.getByLabel('What it bought').selectOption({ label: asset });
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByRole('link', { name: 'KPR Bintaro' })).toBeVisible();
}

test('onboards a loan already running and reads its next twelve months', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await expect(page.getByText(/700\.000\.000/).first()).toBeVisible();

  // Twelve rows to start with, headed by the next payment due from today.
  await expect(page.getByRole('row')).toHaveCount(13);
  await expect(page.getByText('2026-09-25').first()).toBeVisible();
});

test('records the payment the form filled in, and the balance falls', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  // The form fills itself in from the next scheduled row; saving it as it stands is the common case.
  await page.getByRole('button', { name: 'Save payment' }).click();

  await expect(page.getByText(/697\.992\.615/).first()).toBeVisible();

  // Interest is spending; the principal is not.
  await page.goto('/spending');
  await expect(page.getByText(/5\.250\.000/).first()).toBeVisible();
});

test('a rate change moves the payment without posting anything', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Rate change' }).click();
  await page.getByLabel('From').fill('2026-02-25');
  await page.getByLabel('New rate a year (%)').fill('11');
  await page.getByRole('button', { name: 'Save rate change' }).click();

  await expect(page.getByText('11%')).toBeVisible();

  // No money moved, so the bank balance is untouched and no transaction was written.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('500.000.000');
});

test('an extra payment says what it saves before it is written', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Extra payment' }).click();
  await page.getByLabel(/How much/).fill('50000000');

  await expect(page.getByTestId('what-if')).toContainText('months earlier');
  await expect(page.getByTestId('what-if')).toContainText('of interest');

  await page.getByRole('button', { name: 'Save extra payment' }).click();
  await expect(page.getByText(/650\.000\.000/).first()).toBeVisible();
});

test('the balance sheet splits a loan into this year and later', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.goto('/net-worth');
  await expect(page.getByText('Due within a year').first()).toBeVisible();
  await expect(page.getByText('Long-term').first()).toBeVisible();
  // Only the next twelve months of principal fall due this year, so both columns carry something.
  await expect(page.getByTestId('net-worth')).toContainText('500.000.000');
});

test('a card purchase turned into instalments splits into billed and unbilled', async ({ page }) => {
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '12000000');

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA KrisFlyer' }).click();
  await page.getByRole('button', { name: 'Add a plan' }).click();
  await page.getByLabel('What it was').fill('iBox Grand Indonesia');
  await page.getByLabel(/^Total/).fill('12000000');
  await page.getByLabel('Over how many months').fill('12');
  await page.getByRole('button', { name: 'Save plan' }).click();

  await expect(page.getByText('iBox Grand Indonesia')).toBeVisible();
  await expect(page.getByText('earns no points')).toBeVisible();
  await expect(page.getByText(/1\.000\.000 a month/)).toBeVisible();
});
