import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
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
  await page.getByLabel('RDN bank', { exact: true }).pressSequentially('CIMB Niaga');
  await page.getByLabel('Balance now', { exact: true }).pressSequentially('8000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/accounts$/);

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
  await expect(page.getByTestId('balance-card')).toContainText('RDN at CIMB Niaga · IDR');
  const held = page.getByTestId('broker-holding');
  await expect(held).toHaveCount(1);
  await expect(held).toContainText('BBRI');
  await expect(held).toContainText('5 lots');
  const details = page.locator('section').filter({ hasText: 'Details' });
  await expect(details).toContainText('BrokerStockbit Sekuritas');
  await expect(details).toContainText('RDN bankCIMB Niaga');

  await held.click();
  await expect(page.getByText('Value now')).toBeVisible();
  await expect(page.getByLabel('Kept at', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByRole('main')).toContainText('Stockbit Sekuritas');
  await expect(page.getByRole('main')).toContainText('Cash throughRDN at CIMB Niaga');
});

test('a fund account opened by a walk is called by the broker it names', async ({ page }) => {
  await openAccount(page, { subtype: 'fund', name: 'Mirae Asset Sekuritas', bank: 'Bank Central Asia', balance: '1000000' });
  await page.getByRole('link', { name: /^Mirae Asset Sekuritas/ }).first().click();
  await expect(page.getByTestId('balance-card')).toContainText('RDN at Bank Central Asia · IDR');
});
