import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { addForm, addTransaction } from './add-transaction';
import { openDrawers } from './drawers';
import { mockRates, openWithPockets } from './pockets';
import { setCurrency } from './currency-field';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** An account's own page, from the Accounts list. */
async function openMoney(page: Page, name: string) {
  await page.goto('/accounts');
  await openTypes(page);
  await page.getByRole('link', { name, exact: true }).first().click();
}

/** A deposit or an RDN, which live on the asset list rather than the money one. */
async function openHeld(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

test('a current account: its actions, its last rows, its ⋯ and a way to add a currency', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000', extra: (p) => p.getByLabel('Bank', { exact: true }).pressSequentially('Bank One') });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Groceries run', paidWith: 'Everyday', category: 'Groceries', amount: '245000' });

  await openMoney(page, 'Everyday');
  await expect(page.getByText('Bank One · Current account · IDR')).toBeVisible();
  for (const action of ['Spend', 'Receive', 'Transfer']) await expect(page.getByRole('link', { name: action, exact: true })).toBeVisible();
  await expect(page.getByTestId('account-recent')).toContainText('Groceries run');
  await expect(page.getByRole('link', { name: 'Add a currency' })).toBeVisible();

  // The ⋯ holds the settings, the rename and the archive; the code it files under lives in the settings alone.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  for (const item of ['Settings', 'Edit', 'Archive']) await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Tax report code/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'See all' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=/);
  await expect(page.getByText('Groceries run')).toBeVisible();
});

test('a current account takes a second currency and becomes one with pockets, keeping what it held', async ({ page }) => {
  await mockRates(page, { USD: 16_250 });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Groceries run', paidWith: 'Everyday', category: 'Groceries', amount: '245000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('link', { name: 'Add a currency', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a currency' })).toBeVisible();
  // The currency it already holds is not offered again.
  await expect(page.getByLabel('Currency', { exact: true }).locator('option[value="IDR"]')).toHaveCount(0);
  await setCurrency(page.getByLabel('Currency', { exact: true }), 'USD');
  await page.getByLabel('Opening USD').pressSequentially('500');
  await page.getByLabel('Rate: IDR per 1 USD').pressSequentially('16250');
  await page.getByRole('button', { name: 'Add pocket' }).click();

  // The same name, now an account with pockets: the rupiah it held (with the groceries behind it) and the dollars.
  await expect(page.getByText('Balance, all pockets')).toBeVisible();
  await expect(page.getByText('2 currencies')).toBeVisible();
  await expect(page.getByTestId('pocket-IDR')).toContainText('12.255.000');
  await expect(page.getByTestId('pocket-USD')).toContainText('500');
  await page.getByTestId('pocket-IDR').click();
  await expect(page.getByTestId('account-recent')).toContainText('Groceries run');
});

test('Spend opens a new transaction already paid with the account', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('link', { name: 'Spend', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?/);
  await expect(addForm(page).getByRole('button', { name: 'Paid with' })).toContainText('Everyday');
});

test('cash has nothing to add a currency to', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Pocket cash');
  await expect(page.getByRole('link', { name: 'Spend', exact: true })).toBeVisible();
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await expect(page.getByRole('link', { name: 'Add a currency' })).toHaveCount(0);
});

test('an RDN is topped up from a current account: Top up opens a transfer into it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'fund', name: 'Broker cash', balance: '8000000' });
  await openHeld(page, 'Broker cash');
  await expect(page.getByRole('link', { name: 'Withdraw', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spend', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Top up', exact: true }).click();
  const form = addForm(page);
  await expect(form.getByRole('radio', { name: 'Transfer', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: /^To/ })).toContainText('Broker cash');
});

test('a deposit reads as its maturity, and its one action is Break early', async ({ page }) => {
  await openAccount(page, { subtype: 'time_deposit', name: 'Six month deposit', balance: '50000000', matures: '2099-01-15', interestRate: '4,25' });
  await openHeld(page, 'Six month deposit');
  const card = page.getByTestId('deposit-maturity-card');
  await expect(card).toContainText('Matures 15 Jan 2099');
  await expect(card).toContainText('days left · 4,25% · pays ≈ Rp');
  await expect(card.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Break early' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spend', exact: true })).toHaveCount(0);
  // One card: the balance with its maturity inside it, and no month's line — a deposit moves only when it pays.
  const figure = page.getByTestId('deposit-card');
  await expect(figure).toContainText('Balance');
  await expect(figure).toContainText('Time deposit · IDR');
  await expect(figure.getByTestId('deposit-maturity-card')).toBeVisible();
  await expect(figure).not.toContainText('30 days ago');
  await expect(page.getByText('Last 12 months')).toHaveCount(0);
  // What happens at maturity, said in words; the term and the day it was placed among the facts.
  await expect(page.getByLabel('Roll over', { exact: true })).toHaveValue('off');
  await expect(page.getByTestId('maturity-settings')).toContainText('Ask me on the day');
  await expect(page.getByLabel('Term', { exact: true })).toBeVisible();
  await expect(page.getByText('Placed on')).toBeVisible();
  // The terms are changed from the card: Change opens them in a sheet.
  await card.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('dialog', { name: 'Deposit terms' })).toBeVisible();
});

test('cash and a current account draw the balance as one card with the month behind it, read a day at a time', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  for (const name of ['Pocket cash', 'Everyday']) {
    await openMoney(page, name);
    const card = page.getByTestId('balance-card');
    await expect(card).toContainText('Balance');
    await expect(card).toContainText('30 days ago');
    await expect(card).toContainText('today');
    // The year's chart is gone: the card's month is the page's one line.
    await expect(page.getByText('Last 12 months')).toHaveCount(0);
  }
  const line = page.getByTestId('balance-line');
  const box = (await line.boundingBox())!;
  await expect(page.getByTestId('net-worth-reading')).toHaveCount(0);
  await line.click({ position: { x: box.width - 4, y: box.height / 2 } });
  const reading = page.getByTestId('net-worth-reading');
  await expect(reading).toContainText('12.500.000');
  await expect(reading).toContainText(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/);
  await line.press('Escape');
  await expect(page.getByTestId('net-worth-reading')).toHaveCount(0);
});

test('an account with pockets lists them, and a pocket opens its own page with the parent as the way back', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Valas Plus', bank: 'Bank One', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await openMoney(page, 'Valas Plus');
  await expect(page.getByText('Balance, all pockets')).toBeVisible();
  await expect(page.getByText('Bank One · Saving account · 2 currencies')).toBeVisible();
  await expect(page.getByTestId('balance-card')).toContainText('30 days ago');
  // Each pocket is its own row under the actions: its flag, its code and its amount, with no name repeated under it.
  await expect(page.getByTestId('pocket-USD')).toContainText('USD');
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).not.toContainText('US Dollar');
  await expect(page.getByRole('link', { name: 'Move', exact: true })).toBeVisible();
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await page.getByTestId('pocket-USD').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Valas Plus · USD' })).toBeVisible();
  await expect(page.getByText('Opened at')).toBeVisible();
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).first().click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});
