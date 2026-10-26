import { expect, test } from '@playwright/test';
import { openAccount, showBalance } from './accounts';
import { openDrawers } from './drawers';
import { addHoldingFlow } from './securities';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a fund account names its broker and its RDN bank, lists what the broker keeps, and each holding says where its cash goes', async ({ page }) => {
  // The form asks for the broker and the RDN bank, and for no name of its own.
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Fund account/ }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await page.getByLabel('Broker', { exact: true }).pressSequentially('Stockbit Sekuritas');
  await page.getByLabel('Custodian', { exact: true }).pressSequentially('CIMB Niaga');
  await page.getByLabel('Current balance', { exact: true }).pressSequentially('8000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  // One account per broker: the same broker again is refused, and says why.
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Fund account/ }).click();
  await page.getByLabel('Broker', { exact: true }).pressSequentially('stockbit sekuritas');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('alert')).toContainText('Stockbit Sekuritas already has a fund account');

  await addHoldingFlow(page, { search: 'BBRI', broker: 'Stockbit Sekuritas', quantity: '5', price: '4.200', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBRI' })).toBeVisible();

  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Stockbit Sekuritas/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Stockbit Sekuritas' })).toBeVisible();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('Custodian · CIMB Niaga');
  const held = page.getByTestId('broker-holding');
  await expect(held).toHaveCount(1);
  await expect(held).toContainText('BBRI');
  await expect(held).toContainText('5 lots');
  // The broker is the title and the RDN bank is on the card, so Details doesn't say them again.
  await expect(page.locator('section').filter({ hasText: 'Details' }).filter({ hasText: 'Custodian' })).toHaveCount(0);

  await held.click();
  await expect(page.getByText('Value now')).toBeVisible();
  // The share's page keeps no Ticker, Broker or Custodian row: they are in its Settings, with its derived name.
  await expect(page.getByLabel('Broker', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText('Custodian');
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Broker', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByRole('main')).toContainText('BBRI · Stockbit Sekuritas');
  await expect(page.getByRole('main')).toContainText('CIMB Niaga');
  // Custodian taps through to the broker's own Settings, where its bank is named.
  await page.getByRole('link', { name: /Custodian/ }).click();
  await expect(page.getByLabel('Nama bank/institusi')).toHaveValue('CIMB Niaga');
});

test('a fund account opened by a walk is called by the broker it names', async ({ page }) => {
  await openAccount(page, { subtype: 'fund', name: 'Mirae Asset Sekuritas', bank: 'Bank Central Asia', balance: '1000000' });
  await page.getByRole('link', { name: /^Mirae Asset Sekuritas/ }).first().click();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('Custodian · Bank Central Asia');
});
