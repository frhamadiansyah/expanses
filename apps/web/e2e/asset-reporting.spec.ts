import { expect, type Page, test } from '@playwright/test';
import { openAccount, openSettings as openSettingsMenu } from './accounts';
import { openAssets } from './drawers';

/** Accounts created by these tests are opened today, so this year is the year that holds them. */
const YEAR = new Date().getFullYear();

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addBankAsset(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000', opened: `${YEAR}-01-02` });
}

async function openSettings(page: Page) {
  await openAssets(page);
  await page.getByRole('link', { name: /BCA Tahapan/ }).click();
  // Settings live behind the account's ⋯ now, on a page of their own — off the chart and the history they sat under.
  await openSettingsMenu(page);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel('Report as harta', { exact: true })).toBeVisible();
}

async function startReport(page: Page) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

test('an asset kept off the report still counts toward net worth', async ({ page }) => {
  await addBankAsset(page);

  await openSettings(page);
  // Kept as it is switched: the switch reads off once that is saved.
  await page.getByLabel('Report as harta', { exact: true }).click();
  await expect(page.getByLabel('Report as harta', { exact: true })).not.toBeChecked();

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
  await page.getByRole('button', { name: /^Tax report code/ }).click();
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill('0109');
  await expect(page.getByText('Setara kas lainnya')).toBeVisible();
  await page.getByRole('button', { name: 'Save code' }).click();
  await expect(page.getByRole('button', { name: /^Tax report code/ })).toContainText('0109 · Setara kas lainnya');

  await startReport(page);
  await expect(page.getByText('0109').first()).toBeVisible();
  await expect(page.getByText('0102')).toHaveCount(0);
});
