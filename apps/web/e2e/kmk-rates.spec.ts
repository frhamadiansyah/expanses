import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

/** Accounts created here are opened today, so this is the year that holds them. */
const YEAR = new Date().getFullYear();

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addUsdAsset(page: Page) {
  // Money is an account, not an asset: a fund account in USD, opened at its day's own rate.
  await openAccount(page, { subtype: 'fund', name: 'Interactive Brokers', currency: 'USD', balance: '10000', rate: '16000', opened: `${YEAR}-01-02` });
}

async function startReport(page: Page) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

test('a holding in another currency says its rate is missing, then converts once it is entered', async ({ page }) => {
  await addUsdAsset(page);
  await startReport(page);

  // Until the rate is entered the holding is reported as nothing, and the report says so plainly.
  await expect(page.getByText(/Nothing is entered for USD yet/)).toBeVisible();

  await page.getByLabel('USD rate').fill('17714');
  await page.getByLabel('USD decree').fill('KMK 42/MK/EF.2/2026');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('USD rate saved.')).toBeVisible();

  // USD 10.000 at 17.714 is Rp 177.140.000.
  await expect(page.getByText(/Nothing is entered for USD yet/)).toHaveCount(0);
  await expect(page.getByText('177.140.000').first()).toBeVisible();
});

test('a rate typed from the wrong week can be corrected', async ({ page }) => {
  await addUsdAsset(page);
  await startReport(page);

  await page.getByLabel('USD rate').fill('16000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('USD rate saved.')).toBeVisible();

  await page.getByLabel('USD rate').fill('17714');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('177.140.000').first()).toBeVisible();
  await expect(page.getByText('160.000.000')).toHaveCount(0);
});

test('a report with nothing held abroad never asks for a rate', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000', opened: `${YEAR}-01-02` });

  await startReport(page);

  await expect(page.getByRole('heading', { name: `Exchange rates for ${YEAR}` })).toHaveCount(0);
});
