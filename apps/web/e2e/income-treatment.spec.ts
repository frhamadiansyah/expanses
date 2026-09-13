import { expect, type Page, test } from '@playwright/test';

/** Trades recorded by these tests are dated this year, so this is the year that holds them. */
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

async function addHolding(page: Page, kind: string, name: string, cost: string) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption(kind);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Bought on').fill(`${YEAR}-02-10`);
  await page.getByLabel('How much').fill('100');
  await page.getByLabel('Total cost (IDR)').fill(cost);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
}

/** A dividend of Rp 1.000.000 with Rp 100.000 withheld, paid into the bank. */
async function recordDividend(page: Page) {
  await page.goto('/net-worth/trades');
  await page.getByLabel('What happened').selectOption('income');
  await page.getByLabel('Holding').selectOption({ label: 'BBRI shares' });
  await page.getByLabel('Date').fill(`${YEAR}-06-10`);
  await page.getByLabel('Money account').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Amount before tax (IDR)').fill('1000000');
  await page.getByLabel('Tax withheld (IDR)').fill('100000');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Recorded.')).toBeVisible();
}

async function startReport(page: Page) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

test('a dividend whose holding says nothing is set apart, not counted into a band', async ({ page }) => {
  await addBankAsset(page);
  await addHolding(page, 'stock', 'BBRI shares', '1900000');
  await recordDividend(page);

  await startReport(page);

  // The app will not guess which box it belongs in, and says so rather than adding it up wrongly.
  await expect(page.getByRole('heading', { name: /Not set/ })).toBeVisible();
  await expect(page.getByText(/Left out of every total above/)).toBeVisible();
});

test('a reinvested part leaves the tax behind on the rest', async ({ page }) => {
  await addBankAsset(page);
  await addHolding(page, 'stock', 'BBRI shares', '1900000');
  await addHolding(page, 'bond', 'SBN ORI025', '5000000');

  // How its income is taxed belongs to the holding: this one is final.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /BBRI shares/ }).click();
  await page.getByLabel('How its income is taxed').selectOption('final');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await recordDividend(page);

  // Rp 400.000 of the Rp 1.000.000 went back in, and the SBN is where it went.
  await page.getByLabel(`Reinvested from ${YEAR}-06-10`).fill('400000');
  await page.getByLabel(`Reinvested into for ${YEAR}-06-10`).selectOption({ label: 'SBN ORI025' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Recorded as reinvested/)).toBeVisible();

  await startReport(page);

  // The reinvested part is reported with no tax; the rest keeps the holding's treatment and all of it.
  const notObject = page.locator('li', { hasText: 'BBRI shares' }).filter({ hasText: 'reinvested into SBN ORI025' });
  await expect(notObject).toContainText('400.000');
  // Coretax works the tax out from the gross, so no row carries a tax figure of its own.
  await expect(notObject).not.toContainText('tax');

  await expect(page.getByRole('heading', { name: /Tidak termasuk objek pajak/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Final tax/ })).toBeVisible();

  const final = page.locator('li', { hasText: 'BBRI shares' }).filter({ hasNotText: 'reinvested into' });
  await expect(final).toContainText('600.000');

  // All of the withheld tax stays with the part still taxable, and only the band subtotal shows it.
  const finalBand = page.locator('div').filter({ has: page.getByRole('heading', { name: /Final tax/ }) }).last();
  await expect(finalBand).toContainText('100.000');

  // The exemption holds only if that report reaches DJP too, which this app cannot send.
  await expect(page.getByText(/Laporan Realisasi Investasi/)).toBeVisible();
});
