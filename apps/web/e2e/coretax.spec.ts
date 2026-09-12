import { expect, type Page, test } from '@playwright/test';

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

/** A bank account added as an asset, so it carries a Coretax section and its fields can be filled. */
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
  await page.goto('/net-worth/coretax');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
}

test('lists a row in every table the year actually has', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '4000000');
  await addGold(page);

  await startReport(page);

  // Kas for the bank, Harta Lainnya for the gold, Utang for the card.
  await expect(page.getByRole('heading', { name: 'Kas dan Setara Kas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Harta Lainnya' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Utang', exact: true })).toBeVisible();
  // The codes are the real three-digit ones.
  await expect(page.getByText('012').first()).toBeVisible();
  await expect(page.getByText('051').first()).toBeVisible();
  await expect(page.getByText('102').first()).toBeVisible();
});

test('says what is missing before it can be filed, and stops saying it once fixed', async ({ page }) => {
  await addBankAsset(page);

  await startReport(page);
  await expect(page.getByText(/needs Atas nama|needs Nama bank/).first()).toBeVisible();

  // The Coretax details live on the asset, which is where the link sends you.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: /BCA Tahapan/ }).click();
  await page.getByLabel('Atas nama').fill('Fandrian');
  await page.getByLabel('Nama bank/institusi').fill('Bank Central Asia');
  await page.getByLabel('Lokasi harta').fill('IDN');
  await page.getByRole('button', { name: 'Save Coretax details' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.goto('/net-worth/coretax');
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

  await page.goto('/net-worth/coretax');
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
