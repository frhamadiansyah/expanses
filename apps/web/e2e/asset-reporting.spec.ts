import { expect, type Page, test } from '@playwright/test';

/** Accounts created by these tests are opened today, so this year is the year that holds them. */
const YEAR = new Date().getFullYear();

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addBankAsset(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('cash');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Open date').fill(`${YEAR}-01-02`);
  await page.getByLabel(/Balance today/).fill('50000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /BCA Tahapan/ })).toBeVisible();
}

async function openSettings(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /BCA Tahapan/ }).click();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();
}

async function startReport(page: Page) {
  await page.goto('/net-worth/coretax');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

test('an asset kept off the report still counts toward net worth', async ({ page }) => {
  await addBankAsset(page);

  await openSettings(page);
  await page.getByLabel('Report this as harta').uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await startReport(page);
  await expect(page.getByText('0102')).toHaveCount(0);

  // The money is still yours: BPJS JHT is the case this exists for.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('50.000.000');
});

test('the tax report uses the code you chose, not the one the preset guessed', async ({ page }) => {
  await addBankAsset(page);

  await openSettings(page);
  // DJP tells you to pick what matches: DPLK can be savings, setara kas, or an investment code.
  await page.getByLabel('Tax report code').fill('0109');
  await expect(page.getByText('Setara kas lainnya')).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await startReport(page);
  await expect(page.getByText('0109').first()).toBeVisible();
  await expect(page.getByText('0102')).toHaveCount(0);
});
