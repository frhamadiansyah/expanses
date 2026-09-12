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

async function addGold(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('gold');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

test('shows net worth, the balance sheet and both sides of it', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '10000000');

  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
  await expect(page.getByText('Cash & equivalents').first()).toBeVisible();
  await expect(page.getByText('Due within a year').first()).toBeVisible();
  await expect(page.getByText(/Net worth =/)).toBeVisible();
});

test('says it does not know the cash-flow ratios until there are transactions', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth');
  await expect(page.getByText('Financial health')).toBeVisible();
  await expect(page.getByText('Savings rate')).toBeVisible();
  await expect(page.getByText('Not enough data').first()).toBeVisible();
  await expect(page.getByText('Debt to assets')).toBeVisible();
});

test('switches the ratios between the rolling year and a calendar year', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth');
  await page.getByRole('button', { name: 'Last 12 months' }).click();
  await expect(page.getByRole('button', { name: 'Last 12 months' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '2026', exact: true }).click();
  await expect(page.getByRole('button', { name: '2026', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('moves net worth by the price difference only', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/net-worth');
  // The past purchase came from Opening Balances, so the bank balance stayed put and gold was added at cost.
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');

  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Update prices' }).click();
  await page.getByLabel(/Antam gold bars/).fill('1900000');
  await page.getByRole('button', { name: 'Save prices' }).click();
  // 10 g at Rp 1.900.000 on the assets list first, so a failure points at the right step.
  await expect(page.getByText(/19\.000\.000/).first()).toBeVisible();

  await page.goto('/net-worth');
  // 10 g at Rp 1.900.000 is Rp 19.000.000, against Rp 18.600.000 paid: only the Rp 400.000 difference moves.
  await expect(page.getByTestId('net-worth')).toContainText('69.000.000');
});
