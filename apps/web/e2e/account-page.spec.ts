import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { addForm, addTransaction } from './add-transaction';
import { openDrawers } from './drawers';
import { mockRates, openWithPockets } from './pockets';

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

  // The ⋯ holds the settings and the code the account files under, with the code as its second line.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Tax report code/ })).toContainText('0102');
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'See all' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=/);
  await expect(page.getByText('Groceries run')).toBeVisible();
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
});

test('an account with pockets lists them, and a pocket opens its own page with the parent as the way back', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Valas Plus', bank: 'Bank One', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await openMoney(page, 'Valas Plus');
  await expect(page.getByText('Balance, all pockets')).toBeVisible();
  await expect(page.getByText('Bank One · Saving account · 2 currencies')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Move', exact: true })).toBeVisible();
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await page.getByTestId('pocket-USD').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Valas Plus · USD' })).toBeVisible();
  await expect(page.getByText('Opened at')).toBeVisible();
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).first().click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});
