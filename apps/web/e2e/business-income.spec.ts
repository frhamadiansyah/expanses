import { expect, type Page, test } from '@playwright/test';

/** Sales recorded by these tests are dated today, so this is the year that holds them. */
const YEAR = new Date().getFullYear();

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page, name: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('0');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** A sale: money into a wallet against an income category, which is what makes it turnover. */
async function recordSale(page: Page, into: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('button', { name: 'Income', exact: true }).click();
  await page.getByLabel('Description').fill('Sale');
  await page.getByLabel('Received into').selectOption({ label: `${into} (IDR)` });
  await page.getByLabel('Category').selectOption({ label: 'Other Income' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Sale').first()).toBeVisible();
}

async function startReport(page: Page) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

async function addBusiness(page: Page, options: { name: string; scheme: string; wallet: string; norma?: string; threshold?: boolean }) {
  await page.getByRole('button', { name: 'Add a business' }).click();
  await page.getByLabel('Name', { exact: true }).fill(options.name);
  await page.getByLabel('How it is taxed').selectOption(options.scheme);
  await page.getByLabel('Business wallet').selectOption({ label: options.wallet });
  if (options.norma !== undefined) await page.getByLabel('Norma percentage').fill(options.norma);
  if (options.threshold === false) await page.getByLabel(/first slice/).uncheck();
  await page.getByRole('button', { name: 'Save business' }).click();
}

test('sales in the business wallet become turnover, and the exempt slice keeps the tax at nothing', async ({ page }) => {
  await addWallet(page, 'Business wallet');
  await recordSale(page, 'Business wallet', '10000000');

  await startReport(page);
  await addBusiness(page, { name: 'Warung', scheme: 'umkm_final', wallet: 'Business wallet' });

  const row = page.getByTestId('umkm-row');
  await expect(row).toContainText('Warung');
  await expect(row).toContainText('10.000.000');
  // Under the exempt slice, so nothing is owed however much was sold.
  await expect(row).toContainText('tax for the year Rp 0');
});

test('switching the exempt slice off charges 0,5% from the first rupiah', async ({ page }) => {
  await addWallet(page, 'Business wallet');
  await recordSale(page, 'Business wallet', '10000000');

  await startReport(page);
  await addBusiness(page, { name: 'Warung', scheme: 'umkm_final', wallet: 'Business wallet', threshold: false });

  await expect(page.getByTestId('umkm-row')).toContainText('50.000');
});

test('money moved in from the family wallet is not a sale', async ({ page }) => {
  await addWallet(page, 'Business wallet');
  await addWallet(page, 'Family wallet');
  await recordSale(page, 'Business wallet', '10000000');

  // A float from the family wallet lands in the account, but nobody bought anything.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('button', { name: 'Transfer' }).click();
  await page.getByLabel('From').selectOption({ label: 'Family wallet (IDR)' });
  await page.getByLabel('To').selectOption({ label: 'Business wallet (IDR)' });
  await page.getByLabel('Amount', { exact: true }).fill('50000000');
  await page.getByRole('button', { name: 'Save' }).click();

  await startReport(page);
  await addBusiness(page, { name: 'Warung', scheme: 'umkm_final', wallet: 'Business wallet', threshold: false });

  const row = page.getByTestId('umkm-row');
  await expect(row).toContainText('10.000.000');
  await expect(row).not.toContainText('60.000.000');
});

test('an affiliate on norma reports net income, not a tax', async ({ page }) => {
  await addWallet(page, 'Business wallet');
  await recordSale(page, 'Business wallet', '20000000');

  await startReport(page);
  await addBusiness(page, { name: 'Shopee affiliate', scheme: 'nppn', wallet: 'Business wallet', norma: '50' });

  const row = page.getByTestId('nppn-row');
  await expect(row).toContainText('Shopee affiliate');
  // Half of Rp 20.000.000 is net income, taxed progressively with everything else.
  await expect(row).toContainText('net income');
  await expect(row).toContainText('10.000.000');
});
