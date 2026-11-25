import { expect, type Page, test } from '@playwright/test';
import { showBalance } from './accounts';
import { addForm } from './add-transaction';
import { openDrawers } from './drawers';
import { addHoldingFlow } from './securities';

/*
 * A Fund account (a broker's cash, an RDN) has two names (owner, 25 Nov): the broker is its name, the custodian bank its
 * Nama institusi. Lists of money call it by the bank; its page says the broker under it; its Settings name both; a
 * stock kept there still says the broker. Invented brokers, banks and figures.
 */

const SHOTS = process.env.FUND_NAMES_SHOTS;
const shot = async (page: Page, name: string, fullPage = false) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

async function addBank(page: Page, name: string, balance: string) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Current account/ }).tap();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Current balance', { exact: true }).pressSequentially(balance);
  await page.getByRole('button', { name: 'Add account' }).tap();
  await expect(page).not.toHaveURL(/\/accounts\/new$/);
}

async function addFund(page: Page, broker: string, custodian: string, balance: string) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Fund account/ }).tap();
  await page.getByLabel('Broker', { exact: true }).fill(broker);
  if (custodian) await page.getByLabel('Custodian', { exact: true }).fill(custodian);
  await page.getByLabel('Current balance', { exact: true }).pressSequentially(balance);
  await page.getByRole('button', { name: 'Add account' }).tap();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
}

const moneyRow = (page: Page, name: string) => page.getByRole('main').getByRole('link', { name: new RegExp(`^${name}`) });

test('a fund account is its custodian bank among money, its broker on its page, in its Settings and on its stocks', async ({ page }) => {
  await addBank(page, 'Bank Contoh', '8250000');
  await addFund(page, 'Sekuritas Satu', 'Bank Kustodian', '10500000');
  await addFund(page, 'Sekuritas Dua', '', '4500000');
  await addHoldingFlow(page, { search: 'BBRI', broker: 'Sekuritas Satu', quantity: '5', price: '4.200' });
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page.getByRole('heading', { name: 'BBRI' })).toBeVisible();

  // Assets: titled by the bank, nothing new under it; with no bank named, by its broker as before.
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await expect(moneyRow(page, 'Bank Kustodian')).toHaveCount(1);
  await expect(moneyRow(page, 'Sekuritas Satu')).toHaveCount(0);
  await expect(moneyRow(page, 'Sekuritas Dua')).toHaveCount(1);
  await expect(moneyRow(page, 'Bank Kustodian')).not.toContainText('Sekuritas Satu');
  await shot(page, 'money-list', true);
  // Net worth's own sheet reads the same; the share kept there still says its broker.
  await page.goto('/net-worth');
  await openDrawers(page);
  await expect(moneyRow(page, 'Bank Kustodian')).toHaveCount(1);
  await expect(moneyRow(page, 'Sekuritas Satu')).toHaveCount(0);
  await expect(moneyRow(page, 'BBRI · Sekuritas Satu')).toHaveCount(1);
  await shot(page, 'net-worth-overview', true);

  // A transfer's To list names it by the bank too.
  await page.goto('/transactions/new?mode=transfer');
  const form = addForm(page);
  await form.getByRole('button', { name: /^To/ }).tap();
  const sheet = page.getByRole('dialog', { name: 'To', exact: true });
  await expect(sheet.getByTestId('payment-sections')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Bank Kustodian/ })).toHaveCount(1);
  await expect(sheet.getByRole('button', { name: /^Sekuritas Satu/ })).toHaveCount(0);
  await shot(page, 'transfer-to-picker');
  await page.keyboard.press('Escape');

  // Its page: the bank on top, the broker under the balance, and what the broker keeps headed by the broker.
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await moneyRow(page, 'Bank Kustodian').first().tap();
  await expect(page.getByRole('heading', { name: 'Bank Kustodian' })).toBeVisible();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('Broker · Sekuritas Satu');
  await expect(page.getByText('Held at Sekuritas Satu', { exact: true })).toBeVisible();
  await expect(page.getByTestId('broker-holding')).toContainText('BBRI');
  await shot(page, 'account-page', true);

  // Settings: Broker and Custodian bank on top, the sentence under them; the tax group keeps the RDN's own number.
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).or(page.getByRole('main').getByRole('button', { name: 'Settings', exact: true })).first().tap();
  await expect(page.getByLabel('Broker', { exact: true })).toHaveValue('Sekuritas Satu');
  await expect(page.getByLabel('Custodian bank', { exact: true })).toHaveValue('Bank Kustodian');
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Bank or institution', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('RDN account number', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Shown as Bank Kustodian in Money; as Sekuritas Satu on stocks, funds and their tax lines.');
  await shot(page, 'settings', true);

  // A new custodian bank is kept, and the page is titled by it.
  await page.getByLabel('Custodian bank', { exact: true }).fill('Bank Penyimpan');
  await page.getByLabel('Custodian bank', { exact: true }).press('Enter');
  await expect(page.getByRole('main')).toContainText('Shown as Bank Penyimpan in Money');
  // Kept, not only typed: the account's page, read again, is titled by it.
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Bank Penyimpan' })).toBeVisible();
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await expect(moneyRow(page, 'Bank Penyimpan')).toHaveCount(1);

  // The stock kept there still says the broker, its custodian beside it as a label.
  await moneyRow(page, 'Bank Penyimpan').first().tap();
  await page.getByTestId('broker-holding').tap();
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).tap();
  const broker = page.getByLabel('Broker', { exact: true });
  expect(await broker.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent)).toBe('Sekuritas Satu');
  await expect(broker.locator('option')).not.toContainText(['Bank Penyimpan']);
  await expect(page.getByRole('main')).toContainText('BBRI · Sekuritas Satu');
  await expect(page.getByRole('button', { name: /Custodian/ })).toContainText('Bank Penyimpan');
  await shot(page, 'stock-settings', true);
});

test('two brokers at one custodian bank say their broker under the bank', async ({ page }) => {
  await addFund(page, 'Sekuritas Satu', 'Bank Kustodian', '10500000');
  await addFund(page, 'Sekuritas Tiga', 'Bank Kustodian', '2750000');
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await expect(moneyRow(page, 'Bank Kustodian')).toHaveCount(2);
  await expect(page.getByRole('main').getByText('Sekuritas Satu', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByText('Sekuritas Tiga', { exact: true })).toBeVisible();
  await shot(page, 'money-list-same-bank', true);
  await page.goto('/net-worth');
  await openDrawers(page);
  await expect(moneyRow(page, 'Bank Kustodian')).toHaveCount(2);
  await expect(page.getByRole('main').getByText('Sekuritas Tiga', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
