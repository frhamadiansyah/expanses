import { expect, type Page, test } from '@playwright/test';
import { openAccount, openSettings } from './accounts';
import { openNewAsset, fillDay } from './add-asset';
import { openAssets, openDrawers } from './drawers';
import { addHoldingFlow } from './securities';
import { openTradeForm, openTradeRow, recordTrade } from './trades';

/** Trades recorded by these tests are dated this year, so this is the year that holds them. */
const YEAR = new Date().getFullYear();

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addBankAsset(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000', opened: `${YEAR}-01-02` });
}

/** A listed holding owned before the app, paid from Opening Balances. */
async function addStock(page: Page) {
  await addHoldingFlow(page, { search: 'BBRI', pick: 'BBRI', broker: { new: 'Stockbit' }, quantity: '100', price: '19.000', paidFrom: 'Owned before this app', date: `${YEAR}-02-10` });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBRI' })).toBeVisible();
}

/** A bond named by hand, through the picker's own form. */
async function addBond(page: Page, name: string, cost: string) {
  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await fillDay(page, 'Bought', `${YEAR}-02-10`);
  await page.getByLabel('Par value', { exact: true }).fill('100');
  await page.getByLabel('Purchase value', { exact: true }).fill(cost);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The row is inside its kind's drawer, which the list opens shut.
  await openDrawers(page);
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
}

/** A dividend of Rp 1.000.000 with Rp 100.000 withheld, paid into the bank. */
async function recordDividend(page: Page) {
  // Buy & sell's Income asks which holding, then opens the full form on that holding's page.
  const form = await openTradeForm(page, 'income', 'BBRI');
  await expect(form.getByLabel('What happened')).toHaveValue('income');
  await form.getByLabel('Date').fill(`${YEAR}-06-10`);
  await form.getByLabel('Money account').selectOption({ label: 'BCA Tahapan' });
  await form.getByLabel('Amount before tax (IDR)').fill('1000000');
  await form.getByLabel('Tax withheld (IDR)').fill('100000');
  await recordTrade(page);
}

async function startReport(page: Page) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

test('a dividend whose holding says nothing is set apart, not counted into a band', async ({ page }) => {
  await addBankAsset(page);
  await addStock(page);
  await recordDividend(page);

  await startReport(page);

  // The app will not guess which box it belongs in, and says so rather than adding it up wrongly.
  await expect(page.getByRole('heading', { name: /Not set/ })).toBeVisible();
  await expect(page.getByText(/Left out of every total above/)).toBeVisible();
});

test('a reinvested part leaves the tax behind on the rest', async ({ page }) => {
  await addBankAsset(page);
  await addStock(page);
  await addBond(page, 'SBN ORI025', '5000000');

  // How its income is taxed belongs to the holding: this one is final. It is set on the holding's own settings page.
  await openAssets(page);
  await page.getByRole('link', { name: /BBRI/ }).click();
  await openSettings(page);
  await page.getByLabel('How its income is taxed', { exact: true }).selectOption('final');
  await expect(page.getByLabel('How its income is taxed', { exact: true })).toHaveValue('final');

  await recordDividend(page);

  // Rp 400.000 of the Rp 1.000.000 went back in, and the SBN is where it went: said on the dividend's own line.
  const dividend = await openTradeRow(page, /Dividend BBRI/);
  await dividend.getByLabel(`Reinvested from ${YEAR}-06-10`).fill('400000');
  await dividend.getByLabel(`Reinvested into for ${YEAR}-06-10`).selectOption({ label: 'SBN ORI025' });
  await dividend.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Recorded as reinvested/)).toBeVisible();

  await startReport(page);

  // The reinvested part is reported with no tax; the rest keeps the holding's treatment and all of it.
  // An income line is a row of the kit's group now, not a list item, so the row is named rather than the tag.
  const notObject = page.getByTestId('income-row').filter({ hasText: 'BBRI' }).filter({ hasText: 'reinvested into SBN ORI025' });
  await expect(notObject).toContainText('400.000');
  // Coretax works the tax out from the gross, so no row carries a tax figure of its own.
  await expect(notObject).not.toContainText('tax');

  await expect(page.getByRole('heading', { name: /Tidak termasuk objek pajak/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Final tax/ })).toBeVisible();

  const final = page.getByTestId('income-row').filter({ hasText: 'BBRI' }).filter({ hasNotText: 'reinvested into' });
  await expect(final).toContainText('600.000');

  // All of the withheld tax stays with the part still taxable, and only the band subtotal shows it.
  const finalBand = page.locator('div').filter({ has: page.getByRole('heading', { name: /Final tax/ }) }).last();
  await expect(finalBand).toContainText('100.000');

  // The exemption holds only if that report reaches DJP too, which this app cannot send.
  await expect(page.getByText(/Laporan Realisasi Investasi/)).toBeVisible();
});
