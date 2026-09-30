import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { addTransaction } from './add-transaction';
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
  // The line names where the money is and what kind of account; the currency is the flag in the corner.
  await expect(page.getByText('Bank One · Current account', { exact: true })).toBeVisible();
  await expect(page.getByTestId('card-currency')).toHaveAccessibleName('IDR · Indonesian Rupiah');
  const actions = page.getByRole('group', { name: 'Actions' }).getByRole('button');
  await expect(actions).toHaveText(['Spend', 'Receive', 'Transfer', 'Adjust']);
  await expect(page.getByTestId('account-recent')).toContainText('Groceries run');

  // The ⋯ holds the settings, adding a currency, the rename and the archive; the code it files under lives in the
  // settings alone.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  for (const item of ['Settings', 'Add a currency', 'Edit', 'Archive']) await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add a currency', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add a currency' })).toBeVisible();
  // The currency it already holds is not offered again.
  await expect(page.getByLabel('Currency', { exact: true }).locator('option[value="IDR"]')).toHaveCount(0);
  await setCurrency(page.getByLabel('Currency', { exact: true }), 'USD');
  await page.getByLabel('Opening USD').pressSequentially('500');
  await page.getByLabel('Rate: IDR per 1 USD', { exact: true }).pressSequentially('16250');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).click();

  // The same name, now an account with pockets: the rupiah it held (with the groceries behind it) and the dollars.
  await expect(page.getByText('Balance, all pockets')).toBeVisible();
  await expect(page.getByText('2 currencies')).toBeVisible();
  await expect(page.getByTestId('pocket-IDR')).toContainText('12.255.000');
  await expect(page.getByTestId('pocket-USD')).toContainText('500');
  await page.getByTestId('pocket-IDR').click();
  await expect(page.getByTestId('account-recent')).toContainText('Groceries run');
});

test('Spend on an account with pockets opens paid with the pocket in the workspace’s own currency', async ({ page }) => {
  await mockRates(page, { USD: 16_250 });
  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '300.00', rate: '16250' }, { currency: 'IDR', balance: '5000000' }] });
  await openMoney(page, 'Valas Plus');
  await page.getByRole('button', { name: 'Spend', exact: true }).click();
  // A sheet over the account, named for what it adds, with no tabs to change it.
  const sheet = page.getByRole('dialog', { name: 'New expense' });
  await expect(sheet.getByRole('radio', { name: 'Income', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Paid with' })).toContainText('Valas Plus · IDR');
});

test('Spend opens a new transaction already paid with the account', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Spend', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New expense' });
  await expect(sheet.getByRole('radio', { name: 'Expense', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Paid with' })).toContainText('Everyday');
  await expect(page.getByRole('heading', { name: 'Everyday' })).toBeVisible();
});

test('cash has nothing to add a currency to', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Pocket cash');
  await expect(page.getByRole('button', { name: 'Spend', exact: true })).toBeVisible();
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await expect(page.getByRole('button', { name: /^Add (a )?currency$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Add a currency', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('cash is withdrawn into and counted: a short count is unrecorded spending, and the balance is what was counted', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '932500' });
  await openMoney(page, 'Pocket cash');
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Receive', 'Withdraw', 'Count cash']);

  await page.getByRole('button', { name: 'Count cash', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Count cash' });
  await expect(sheet).toContainText('Rp 932.500');
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  await sheet.getByLabel('Actually have').fill('887500');
  await expect(sheet.getByTestId('adjust-difference')).toContainText('45.000 less than the app says.');
  // Cash that comes up short was nearly always spent: that is the answer it starts on.
  await expect(sheet.getByRole('radio', { name: /Spending I didn’t record/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  await expect(page.getByTestId('balance-card')).toContainText('887.500');
  await expect(page.getByTestId('account-recent').getByTestId('account-recent-row').first()).toContainText('Counted cash');
  await expect(page.getByTestId('account-recent').getByTestId('account-recent-row').first()).toContainText('Unrecorded spending');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 45.000');
});

test('Withdraw brings cash in from a current account, with its ATM fee as spending', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '0' });
  await openMoney(page, 'Pocket cash');
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Cash withdrawal' });
  await expect(sheet.getByLabel('From')).toHaveValue(/.+/);
  await expect(sheet.getByLabel('From').locator('option:checked')).toHaveText('Everyday');
  await sheet.getByLabel('Amount', { exact: true }).fill('500000');
  await sheet.getByLabel('ATM fee').fill('7500');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('balance-card')).toContainText('500.000');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 7.500');
});

test('a current account adjusted as just a correction moves its balance and nothing in Cashflow', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Adjust balance' });
  await sheet.getByLabel('Actually have').fill('12480000');
  // Anything but cash starts on a correction.
  await expect(sheet.getByRole('radio', { name: /Just a correction/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('balance-card')).toContainText('12.480.000');
  await expect(page.getByTestId('account-recent').getByTestId('account-recent-row').first()).toContainText('Balance correction');

  await page.goto('/transactions');
  await expect(page.getByText('Balance adjusted').first()).toBeVisible();
  await expect(page.getByTestId('period-total')).toHaveText('Rp 0');
});

test('a wallet is topped up from a card, with a fee; the ordinary transfer still names no card', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'credit_card', name: 'Travel Card', balance: '0', last4: '4321' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '0' });
  await openMoney(page, 'GoPay');
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Top up', 'Receive', 'Adjust']);

  await page.getByRole('button', { name: 'Top up', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Top up' });
  await expect(sheet.getByLabel('From').locator('option:checked')).toHaveText('Everyday');
  await sheet.getByLabel('From').selectOption({ label: 'Travel Card ···· 4321' });
  await sheet.getByLabel('Amount', { exact: true }).fill('500000');
  await sheet.getByLabel('Top-up fee').fill('1500');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('balance-card')).toContainText('500.000');

  // The card owes the amount and the fee.
  await page.goto('/net-worth/loans');
  await expect(page.getByTestId('debts-kind-total-credit_card')).toHaveText('Rp 501.500');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 1.500');

  // The ordinary Transfer: its From and To list money you hold, never the card.
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  const transfer = page.getByRole('dialog', { name: 'New transfer' });
  for (const side of [/^To/, /^From/]) {
    await transfer.getByRole('button', { name: side }).click();
    const list = page.getByRole('dialog', { name: /^(To|From)$/ });
    await expect(list).toContainText('GoPay');
    await expect(list).not.toContainText('Travel Card');
    await list.getByRole('button', { name: 'Close' }).click();
  }
});

test('an RDN is topped up from a current account: Top up opens a transfer into it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'fund', name: 'Broker cash', balance: '8000000' });
  await openHeld(page, 'Broker cash');
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spend', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Top up', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New transfer' });
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
  await expect(page.getByRole('button', { name: 'Spend', exact: true })).toHaveCount(0);
  // One card: the balance with its maturity inside it, and no month's line — a deposit moves only when it pays.
  const figure = page.getByTestId('deposit-card');
  await expect(figure).toContainText('Balance');
  await expect(figure).toContainText('Time deposit');
  await expect(figure.getByTestId('card-currency')).toHaveAccessibleName(/^IDR/);
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
  // Four actions in one row; adding a currency is the Pockets list's last row, not an action.
  for (const action of ['Spend', 'Receive', 'Transfer']) await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: action, exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Move', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^Add (a )?currency$/ })).toHaveCount(0);
  await expect(page.getByTestId('pocket-add')).toHaveText(/Add a currency/);
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await page.getByTestId('pocket-USD').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Valas Plus · USD' })).toBeVisible();
  await expect(page.getByText('Opened at')).toBeVisible();
  await page.getByRole('button', { name: 'Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('an expense added from an account is saved by the sheet’s ✓ and shows in its Recent', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Spend', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New expense' });
  // No Save bar at the foot: ✕ and ✓ in the header, the ✓ dimmed until the expense would save.
  const save = sheet.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await sheet.getByLabel('Amount', { exact: true }).fill('45000');
  await sheet.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await sheet.getByLabel('Note').fill('Market');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('account-recent')).toContainText('Market');
});
