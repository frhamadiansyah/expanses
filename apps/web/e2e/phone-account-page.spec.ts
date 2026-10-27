import { expect, test } from '@playwright/test';
import { openAccount, walletCard, showBalance } from './accounts';

import { addForm } from './add-transaction';
import { mockRates, openWithPockets } from './pockets';

test('by thumb: an account page spends from itself, and a pocket goes back to its account', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await walletCard(page, 'Everyday').tap();
  // The opening balance is how the account was started: it is not listed under Recent.
  await expect(page.getByTestId('account-recent')).not.toContainText('Opening balance');
  // The corner holds the ⚙ alone: no ⋯, and nothing named Tax report code outside Settings.
  await expect(page.getByRole('main').getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Spend', exact: true }).tap();
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=expense/);
  await expect(addForm(page).getByRole('button', { name: /^Paid with/ })).toContainText('Everyday');
  await page.goBack();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);

  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await walletCard(page, 'Valas Plus').tap();
  await page.getByTestId('pocket-SGD').tap();
  await expect(page.getByRole('heading', { name: 'Valas Plus · SGD' })).toBeVisible();
  await page.getByRole('button', { name: 'Valas Plus', exact: true }).tap();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by thumb: cash is counted and withdrawn into, a wallet topped up, and a current account adds a currency from ⋯', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '932500' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '0' });

  await walletCard(page, 'Pocket cash').tap();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Receive', 'Withdraw', 'Adjust']);
  await page.getByRole('button', { name: 'Adjust', exact: true }).tap();
  const count = page.getByRole('dialog', { name: 'Adjust balance' });
  await count.getByLabel('Actual').fill('887500');
  await expect(count.getByRole('radio', { name: /Spending I didn’t record/ })).toBeChecked();
  await count.getByRole('button', { name: 'Save' }).tap();
  await expect(count).toHaveCount(0);
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('887.500');
  await expect(page.getByTestId('account-recent-row').first()).toContainText('Counted cash');

  await page.getByRole('button', { name: 'Withdraw', exact: true }).tap();
  const withdrawal = page.getByRole('dialog', { name: 'Cash withdrawal' });
  await expect(withdrawal.getByLabel('From').locator('option:checked')).toHaveText('Everyday');
  await withdrawal.getByRole('button', { name: 'Close' }).tap();

  await page.goto('/wallet');
  await walletCard(page, 'GoPay').tap();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Top up', 'Receive', 'Adjust']);
  await page.getByRole('button', { name: 'Top up', exact: true }).tap();
  const topUp = page.getByRole('dialog', { name: 'Top up' });
  await expect(topUp).toContainText('GoPay');
  await topUp.getByLabel('Amount', { exact: true }).fill('150000');
  await topUp.getByRole('button', { name: 'Save' }).tap();
  await expect(topUp).toHaveCount(0);
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('150.000');

  await page.goto('/wallet');
  await walletCard(page, 'Everyday').tap();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Receive', 'Transfer', 'Adjust']);
  await page.getByTestId('add-currency').tap();
  await expect(page.getByRole('dialog', { name: 'Add a currency' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by thumb: a bank with pockets has Spend, Receive, Move and Adjust; Adjust asks which pocket and Spend opens Add with the tabs', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await walletCard(page, 'Valas Plus').tap();
  await expect(page.getByRole('group', { name: 'Actions' }).locator('button, a')).toHaveText(['Spend', 'Receive', 'Move', 'Adjust']);
  await page.getByRole('button', { name: 'Adjust', exact: true }).tap();
  const which = page.getByRole('dialog', { name: 'Adjust which pocket' });
  await which.getByTestId('adjust-pocket-SGD').tap();
  await expect(page.getByRole('dialog', { name: 'Adjust balance' })).toContainText('1.150');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Spend', exact: true }).tap();
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=expense/);
  const form = addForm(page);
  await expect(form.getByRole('radio', { name: 'Income', exact: true })).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Transfer', exact: true })).toBeVisible();
});
