import { expect, type Page, test } from '@playwright/test';
import { openAccount, openWalletAccount, showBalance } from './accounts';
import { addForm, addTransaction, saveButton } from './add-transaction';
import { openDrawers } from './drawers';
import { mockRates, openWithPockets } from './pockets';
import { setCurrency } from './currency-field';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** An account's own page, from its card on Wallet. */
const openMoney = (page: Page, name: string) => openWalletAccount(page, name);

/** A deposit or an RDN, which live on the asset list rather than the money one. */
async function openHeld(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

test('a current account: its actions, its last rows, its ⚙ and a way to add a currency', async ({ page }) => {
  // Shown everywhere with its bank in front of the name typed.
  await openAccount(page, { subtype: 'bank', name: 'Everyday', shown: 'Bank One Everyday', balance: '12500000', extra: (p) => p.getByLabel('Bank', { exact: true }).pressSequentially('Bank One') });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Groceries run', paidWith: 'Bank One Everyday', category: 'Groceries', amount: '245000' });

  await openMoney(page, 'Bank One Everyday');
  // The line names where the money is and what kind of account; the currency is the flag in the corner.
  await showBalance(page);
  await expect(page.getByText('Bank One · Current account', { exact: true })).toBeVisible();
  await expect(page.getByTestId('card-currency')).toHaveAccessibleName('IDR · Indonesian Rupiah');
  const actions = page.getByRole('group', { name: 'Actions' }).locator('button, a');
  await expect(actions).toHaveText(['Add', 'Transfer', 'Adjust', 'Statement']);
  await expect(page.getByTestId('account-recent')).toContainText('Groceries run');

  // The corner is the ⚙ alone: Edit and Archive wait in Settings, and Add a currency is the last row of the facts.
  await expect(page.getByRole('main').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('add-currency')).toBeVisible();

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
  // The last row of the account's facts: the corner holds only its ⚙.
  await page.getByTestId('add-currency').click();
  await expect(page.getByRole('dialog', { name: 'Add a currency' })).toBeVisible();
  // The currency it already holds is not offered again.
  await expect(page.getByLabel('Currency', { exact: true }).locator('option[value="IDR"]')).toHaveCount(0);
  await setCurrency(page.getByLabel('Currency', { exact: true }), 'USD');
  await page.getByLabel('Opening USD').pressSequentially('500');
  await page.getByLabel('Rate: IDR per 1 USD', { exact: true }).pressSequentially('16250');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).click();

  // The same name, now an account with pockets: the rupiah it held (with the groceries behind it) and the dollars.
  await showBalance(page);
  await expect(page.getByText('Balance, all pockets')).toBeVisible();
  await showBalance(page);
  await expect(page.getByText('2 currencies')).toBeVisible();
  await expect(page.getByTestId('pocket-IDR')).toContainText('12.255.000');
  await expect(page.getByTestId('pocket-USD')).toContainText('500');
  await page.getByTestId('pocket-IDR').click();
  await expect(page.getByTestId('account-recent')).toContainText('Groceries run');
});

test('Spend and Receive on a bank with pockets open the Add screen with the pocket in the workspace’s own currency', async ({ page }) => {
  await mockRates(page, { USD: 16_250 });
  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '300.00', rate: '16250' }, { currency: 'IDR', balance: '5000000' }] });
  await openMoney(page, 'Valas Plus');
  await page.getByRole('button', { name: 'Spend', exact: true }).click();
  // The Add screen itself, as ＋ opens it, with the account filled in: its tabs are there, Expense on.
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=expense/);
  const form = addForm(page);
  await expect(form.getByRole('radio', { name: 'Expense', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: /^Paid with/ })).toContainText('Valas Plus · IDR');
  // Receive and Transfer are the tabs: the pocket stays the account on the one it fits.
  await form.getByRole('radio', { name: 'Income', exact: true }).click();
  await expect(form.getByRole('button', { name: /^Received into/ })).toContainText('Valas Plus · IDR');
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await expect(form.getByRole('radio', { name: 'Transfer', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: /^From/ })).toContainText('Valas Plus · IDR');
  // Receive opens the same screen on Income, into the same pocket.
  await page.goBack();
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=income/);
  await expect(addForm(page).getByRole('radio', { name: 'Income', exact: true })).toBeChecked();
  await expect(addForm(page).getByRole('button', { name: /^Received into/ })).toContainText('Valas Plus · IDR');
});

test('a cash account with pockets: Record, Move, Withdraw, Adjust; Withdraw is into the rupiah pocket and Adjust asks which pocket', async ({ page }) => {
  await mockRates(page, { TRY: 480 });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Pocket cash');
  await page.getByTestId('add-currency').click();
  await setCurrency(page.getByLabel('Currency', { exact: true }), 'TRY');
  await page.getByLabel('Opening TRY').pressSequentially('1000');
  await page.getByLabel('Rate: IDR per 1 TRY', { exact: true }).pressSequentially('480');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('pocket-TRY')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).locator('button, a')).toHaveText(['Record', 'Move', 'Withdraw', 'Adjust']);

  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const withdrawal = page.getByRole('dialog', { name: 'Cash withdrawal' });
  await expect(withdrawal.getByLabel('From').locator('option:checked')).toHaveText('Everyday');
  await withdrawal.getByLabel('Amount', { exact: true }).fill('500000');
  await withdrawal.getByRole('button', { name: 'Save' }).click();
  await expect(withdrawal).toHaveCount(0);
  await expect(page.getByTestId('pocket-IDR')).toContainText('800.000');

  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  const which = page.getByRole('dialog', { name: 'Adjust which pocket' });
  await expect(which).toContainText('Turkish Lira');
  await which.getByTestId('adjust-pocket-TRY').click();
  const adjust = page.getByRole('dialog', { name: 'Adjust balance' });
  await expect(adjust).toContainText('1.000');
  await adjust.getByLabel('Actual').fill('900');
  await adjust.getByRole('button', { name: 'Save' }).click();
  await expect(adjust).toHaveCount(0);
  await expect(page.getByTestId('pocket-TRY')).toContainText('900');
});

test('Add opens a new transaction already paid with the account', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=expense.*account=/);
  const form = addForm(page);
  await expect(form.getByRole('radio', { name: 'Expense', exact: true })).toBeChecked();
  await expect(form.getByRole('button', { name: /^Paid with/ })).toContainText('Everyday');
  // Back from the Add screen is the account's page.
  await page.goBack();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible();
});

test('cash takes a second currency like a bank account: it becomes one with pockets, the lira beside the rupiah', async ({ page }) => {
  await mockRates(page, { TRY: 480 });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openMoney(page, 'Pocket cash');
  await expect(page.getByRole('button', { name: 'Spend', exact: true })).toBeVisible();
  // The opening balance is how the account was started: it is not listed under Recent.
  await expect(page.getByTestId('account-recent')).not.toContainText('Opening balance');
  // The last row of the account's facts: the corner holds only its ⚙.
  await page.getByTestId('add-currency').click();
  await setCurrency(page.getByLabel('Currency', { exact: true }), 'TRY');
  await page.getByLabel('Opening TRY').pressSequentially('1000');
  await page.getByLabel('Rate: IDR per 1 TRY', { exact: true }).pressSequentially('480');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).click();
  await showBalance(page);
  await expect(page.getByText('2 currencies')).toBeVisible();
  await expect(page.getByTestId('pocket-IDR')).toContainText('300.000');
  await expect(page.getByTestId('pocket-TRY')).toContainText('1.000');
  // Named as every pocket is, and still cash.
  await page.getByTestId('pocket-TRY').click();
  await expect(page.getByRole('heading', { name: 'Pocket cash · TRY' })).toBeVisible();
});

test('a new cash account offers Multi-currency, and a wallet does not', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Cash/ }).click();
  await expect(page.getByLabel('Multi-currency', { exact: true })).toBeVisible();
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Digital wallet/ }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Multi-currency', { exact: true })).toHaveCount(0);
});

test('a wallet still has nothing to add a currency to', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'Pocket wallet', balance: '300000' });
  await openMoney(page, 'Pocket wallet');
  await expect(page.getByTestId('add-currency')).toHaveCount(0);
});

test('cash is withdrawn into and counted: a short count is unrecorded spending, and the balance is what was counted', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '932500' });
  await openMoney(page, 'Pocket cash');
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Receive', 'Withdraw', 'Adjust']);

  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Adjust balance' });
  await expect(sheet).toContainText('Rp 932.500');
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  await sheet.getByLabel('Actual').fill('887500');
  await expect(sheet.getByTestId('adjust-difference')).toContainText('45.000 less than the balance.');
  // Cash that comes up short was nearly always spent: that is the answer it starts on.
  await expect(sheet.getByRole('radio', { name: /Spending I didn’t record/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  await showBalance(page);
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
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('500.000');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 7.500');
});

test('Withdraw into a dollar cash account from a rupiah bank: what left, the dollars landed, the ATM fee in rupiah', async ({ page }) => {
  await mockRates(page, { USD: 16_000 });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Dollar cash', currency: 'USD', balance: '0', rate: '16000' });
  await openMoney(page, 'Dollar cash');
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Cash withdrawal' });
  await sheet.getByLabel('From').selectOption({ label: 'Everyday' });
  await sheet.getByRole('textbox', { name: 'Received' }).fill('100');
  await sheet.getByLabel('Charged').fill('1600000');
  await sheet.getByLabel('ATM fee').fill('25000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('100');
  await openMoney(page, 'Everyday');
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('10.875.000');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 25.000');
});

test('a current account adjusted as just a correction moves its balance and nothing in Cashflow', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Adjust balance' });
  await sheet.getByLabel('Actual').fill('12480000');
  // Anything but cash starts on a correction.
  await expect(sheet.getByRole('radio', { name: /Just a correction/ })).toBeChecked();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await showBalance(page);
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
  await expect(page.getByRole('group', { name: 'Actions' }).locator('button, a')).toHaveText(['Add', 'Top up', 'Adjust', 'Statement']);

  await page.getByRole('button', { name: 'Top up', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Top up' });
  await expect(sheet.getByLabel('From').locator('option:checked')).toHaveText('Everyday');
  await sheet.getByLabel('From').selectOption({ label: 'Travel Card ···· 4321' });
  await sheet.getByLabel('Amount', { exact: true }).fill('500000');
  await sheet.getByLabel('Top-up fee').fill('1500');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('500.000');

  // The card owes the amount and the fee.
  await page.goto('/net-worth/loans');
  await expect(page.getByTestId('debts-kind-total-credit_card')).toHaveText('Rp 501.500');
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 1.500');

  // The ordinary Transfer: its From and To list money you hold, never the card.
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=transfer/);
  const transfer = addForm(page);
  await expect(transfer.getByRole('radio', { name: 'Transfer', exact: true })).toBeChecked();
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
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=transfer.*to=/);
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

test('cash and a current account draw the balance as one card with the month behind it', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  for (const name of ['Pocket cash', 'Everyday']) {
    await openMoney(page, name);
    const card = page.getByTestId('balance-card');
    await expect(card).toContainText('Balance');
    await showBalance(page);
    await expect(card).toContainText('30 days ago');
    await expect(card).toContainText('today');
    // The year's chart is gone: the card's month is the page's one line.
    await expect(page.getByText('Last 12 months')).toHaveCount(0);
  }
  // The back's line is read by touch like the asset page's: only the small button in the corner turns the card over.
  await expect(page.getByTestId('balance-line')).toHaveCount(1);
});

test('an account with pockets lists them, and a pocket opens its own page with the parent as the way back', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Valas Plus', bank: 'Bank One', shown: 'Bank One Valas Plus', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await openMoney(page, 'Bank One Valas Plus');
  await showBalance(page);
  await expect(page.getByText('Balance, all pockets')).toBeVisible();
  await expect(page.getByText('Bank One · Saving account · 2 currencies')).toBeVisible();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('30 days ago');
  // Each pocket is its own row under the actions: its flag, its code and its amount, with no name repeated under it.
  await expect(page.getByTestId('pocket-USD')).toContainText('USD');
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).not.toContainText('US Dollar');
  // Four actions in one row; adding a currency is the Pockets list's last row, not an action.
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Spend', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Receive', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Adjust', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Move', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: /^Add (a )?currency$/ })).toHaveCount(0);
  await expect(page.getByTestId('pocket-add')).toHaveText(/Add a currency/);
  // The opening balance is how the account was started: it is not listed under Recent.
  await expect(page.getByTestId('account-recent')).not.toContainText('Opening balance');
  await page.getByTestId('pocket-USD').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Bank One Valas Plus · USD' })).toBeVisible();
  await expect(page.getByText('Opened at')).toBeVisible();
  await page.getByRole('button', { name: 'Bank One Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('an expense added from an account is saved by the Add screen’s ✓, goes back to the account and shows in its Recent', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openMoney(page, 'Everyday');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const form = addForm(page);
  // ✓ in the bar, dimmed until the expense would save.
  const save = saveButton(form);
  await expect(save).toBeDisabled();
  await form.getByLabel('Amount', { exact: true }).fill('45000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Market');
  await expect(save).toBeEnabled();
  await save.click();
  // Saved, the app is back on the account's page, where the new row leads its Recent.
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByTestId('account-recent')).toContainText('Market');
});
