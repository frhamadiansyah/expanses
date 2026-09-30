import { expect, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';

import { mockRates, openWithPockets } from './pockets';

test('by thumb: an account page spends from itself, and a pocket goes back to its account', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await page.getByRole('link', { name: 'Everyday', exact: true }).tap();
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Tax report code/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Spend', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'New expense' }).getByRole('button', { name: 'Paid with' })).toContainText('Everyday');
  await page.getByRole('dialog', { name: 'New expense' }).getByRole('button', { name: 'Close' }).tap();

  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await openTypes(page);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).tap();
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
  await openTypes(page);

  await page.getByRole('link', { name: 'Pocket cash', exact: true }).tap();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Receive', 'Withdraw', 'Count cash']);
  await page.getByRole('button', { name: 'Count cash', exact: true }).tap();
  const count = page.getByRole('dialog', { name: 'Count cash' });
  await count.getByLabel('Actually have').fill('887500');
  await expect(count.getByRole('radio', { name: /Spending I didn’t record/ })).toBeChecked();
  await count.getByRole('button', { name: 'Save' }).tap();
  await expect(count).toHaveCount(0);
  await expect(page.getByTestId('balance-card')).toContainText('887.500');
  await expect(page.getByTestId('account-recent-row').first()).toContainText('Counted cash');

  await page.getByRole('button', { name: 'Withdraw', exact: true }).tap();
  const withdrawal = page.getByRole('dialog', { name: 'Cash withdrawal' });
  await expect(withdrawal.getByLabel('From').locator('option:checked')).toHaveText('Everyday');
  await withdrawal.getByRole('button', { name: 'Close' }).tap();

  await page.goto('/accounts');
  await openTypes(page);
  await page.getByRole('link', { name: 'GoPay', exact: true }).tap();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Top up', 'Receive', 'Adjust']);
  await page.getByRole('button', { name: 'Top up', exact: true }).tap();
  const topUp = page.getByRole('dialog', { name: 'Top up' });
  await expect(topUp).toContainText('GoPay');
  await topUp.getByLabel('Amount', { exact: true }).fill('150000');
  await topUp.getByRole('button', { name: 'Save' }).tap();
  await expect(topUp).toHaveCount(0);
  await expect(page.getByTestId('balance-card')).toContainText('150.000');

  await page.goto('/accounts');
  await openTypes(page);
  await page.getByRole('link', { name: 'Everyday', exact: true }).tap();
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Spend', 'Receive', 'Transfer', 'Adjust']);
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Add a currency', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Add a currency' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
