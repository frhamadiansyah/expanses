import { expect, type Page, test } from '@playwright/test';
import { forgetRates } from './pockets';

/** Accounts created by these tests are opened today, so this year is the year that holds them. */
const YEAR = new Date().getFullYear();

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

/** A bank account added as an asset, so it carries a tax-report section and its fields can be filled. */
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

async function addGold(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('gold');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill(`${YEAR}-03-09`);
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

async function startReport(page: Page) {
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

/**
 * The state every other test in this file skips past: the page before anybody starts a report.
 *
 * Each of them clicks "Start the {year} report" as its first action, so all four passed with a red error box
 * on screen — `useReport` handed TanStack Query the legal `undefined` that `reportFor` returns for a year with
 * no row, and the library refuses it with `"<hash> data is undefined"`. The empty state below had been written
 * and had never once rendered, because `isSuccess` can never be true on a query that errored.
 */
test('opens a year with no report yet, and says so instead of erroring', async ({ page }) => {
  await page.goto('/tax-report');

  // The empty state first: it is what proves the query settled, and only then is "no error box" an assertion
  // about the settled page rather than about a page that has not finished asking yet.
  await expect(page.getByText(/Nothing for \d{4} yet/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Start the \d{4} report$/ })).toBeVisible();

  // A year that does have a report is unaffected: the empty state goes and the report renders.
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
  await expect(page.getByText(/Nothing for \d{4} yet/)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('lists a row in every table the year actually has', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '4000000');
  await addGold(page);

  await startReport(page);

  // Kas for the bank, Harta Lainnya for the gold, Utang for the card.
  await expect(page.getByRole('heading', { name: 'Kas dan Setara Kas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Harta Lainnya' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Utang', exact: true })).toBeVisible();
  // The codes are Coretax's four-digit ones; utang keeps the e-Form code, which is all DJP publishes.
  await expect(page.getByText('0102').first()).toBeVisible();
  await expect(page.getByText('0701').first()).toBeVisible();
  await expect(page.getByText('102').first()).toBeVisible();
});

test('says what is missing before it can be filed, and stops saying it once fixed', async ({ page }) => {
  await addBankAsset(page);

  await startReport(page);
  await expect(page.getByText(/needs Atas nama|needs Nama bank/).first()).toBeVisible();

  // The tax-report details live on the asset, which is where the link sends you.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /BCA Tahapan/ }).click();
  await page.getByLabel('Nomor akun').fill('1234567890');
  await page.getByLabel('Atas nama').fill('Fandrian');
  await page.getByLabel('Nama bank/institusi').fill('Bank Central Asia');
  await page.getByLabel('Lokasi harta').fill('IDN');
  await page.getByRole('button', { name: 'Save tax-report details' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await expect(page.getByText('Nothing missing. Every row has what its table asks for.')).toBeVisible();
});

test('freezing keeps the figures when a trade is backdated into the year afterwards', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);
  await startReport(page);

  await page.getByRole('button', { name: `Freeze ${YEAR}` }).click();
  await expect(page.getByText('Frozen. The rows below are the copy; your ledger can move without touching them.')).toBeVisible();

  // A purchase dated back into the frozen year.
  await page.goto('/net-worth/trades');
  await page.getByLabel('Date').fill(`${YEAR}-08-02`);
  await page.getByLabel('Units, shares or grams').fill('5');
  await page.getByLabel('What it cost, before fees (IDR)').fill('9300000');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Recorded\./)).toBeVisible();

  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  // The frozen figure stands, and the change is listed rather than applied.
  await expect(page.getByText(/Frozen at/).first()).toBeVisible();
  await expect(page.getByText(/18\.600\.000/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Use the ledger figure' }).first().click();
  await expect(page.getByText(/27\.900\.000/).first()).toBeVisible();
});

test('explains the gap between the report and the balance sheet', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '4000000');

  await startReport(page);

  await expect(page.getByText(/The report says/)).toBeVisible();
  await expect(page.getByText(/your balance sheet on 31 December/)).toBeVisible();
});

test('says the report stays on this device', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await startReport(page);

  await expect(page.getByText(/stays on this device|nothing is sent anywhere/)).toBeVisible();
});

test('offers a converter file per harta table, and explains why utang has none', async ({ page }) => {
  await addBankAsset(page);
  await startReport(page);

  // Every harta table gets DJP's own sheet, and the CSV beside it for reading.
  await expect(page.getByRole('button', { name: 'Converter file (.tsv)' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV to read' }).first()).toBeVisible();
});

test('gives utang the CSV only, and says why', async ({ page }) => {
  await addBankAsset(page);
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '4000000');

  await startReport(page);

  // A debt reaches the report, and its row offers no converter because DJP publishes none.
  await expect(page.getByText(/Coretax publishes no import for utang/)).toBeVisible();
});

test('will not build a converter file until the report carries an NPWP', async ({ page }) => {
  await addBankAsset(page);
  await startReport(page);

  await expect(page.getByRole('button', { name: 'Converter file (.tsv)' }).first()).toBeDisabled();
  await expect(page.getByText(/The converter sheet starts with your NPWP/)).toBeVisible();

  await page.getByLabel('NPWP').fill('0011223344556677');
  await page.getByRole('button', { name: 'Save taxpayer details' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await expect(page.getByText(/The converter sheet starts with your NPWP/)).toHaveCount(0);
});

test('downloads the converter file once the sheet has everything it needs', async ({ page }) => {
  await addBankAsset(page);
  await startReport(page);
  await page.getByLabel('NPWP').fill('0011223344556677');
  await page.getByRole('button', { name: 'Save taxpayer details' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // The kas sheet needs its account number, owner, institution and country before it can be built.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /BCA Tahapan/ }).click();
  await page.getByLabel('Nomor akun').fill('1234567890');
  await page.getByLabel('Atas nama').fill('Fandrian');
  await page.getByLabel('Nama bank/institusi').fill('Bank Central Asia');
  await page.getByLabel('Lokasi harta').fill('IDN');
  await page.getByRole('button', { name: 'Save tax-report details' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Converter file (.tsv)' }).first().click();
  expect((await download).suggestedFilename()).toContain(`coretax-${YEAR}-kas`);
});

test('the report is not compared with a balance sheet that lacks a rate: the currency is named instead', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addBankAsset(page);
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially('Dollar Saver');
  await page.getByLabel('Currency', { exact: true }).selectOption('USD');
  await page.getByLabel('Current balance').pressSequentially('1000');
  await page.getByLabel(/^Rate: IDR per 1 USD$/).pressSequentially('16250');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Dollar Saver', exact: true })).toBeVisible();
  await startReport(page);
  await expect(page.getByText(/your balance sheet on 31 December/)).toBeVisible();

  // No USD rate anywhere on the device: the balance sheet would count the $1.000 as 0.
  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await expect(page.getByTestId('reconciliation-missing')).toContainText(`No USD rate yet for 31 December ${YEAR}`);
  await expect(page.getByText(/your balance sheet on 31 December \d{4} says/)).toHaveCount(0);
  await expect(page.getByText(/The gap is/)).toHaveCount(0);
});
