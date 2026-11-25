import { expect, test } from '@playwright/test';
import { openAccount, openSettings, showBalance } from './accounts';
import { openDrawers } from './drawers';
import { addHoldingFlow } from './securities';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  void page.route('https://query1.finance.yahoo.com/**', (route) => void route.abort());
});

test('a broker opened from Add holding names its RDN bank in its Settings, and is then listed by that bank with its broker under the balance', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '10000000' });
  await addHoldingFlow(page, { search: 'BBRI', broker: { new: 'Stockbit' }, quantity: '5', price: '4.200', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBRI' })).toBeVisible();

  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Stockbit/ }).first().click();
  await openSettings(page);
  // A fund account's Settings name its Broker and its Custodian bank (owner, 25 Nov).
  await expect(page.getByLabel('Broker', { exact: true })).toHaveValue('Stockbit');
  const bank = page.getByLabel('Custodian bank', { exact: true });
  await bank.fill('CIMB Niaga');
  await bank.press('Enter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CIMB Niaga' })).toBeVisible();

  // Listed by the bank its cash is at; the broker is under the balance.
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^CIMB Niaga/ }).first().click();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('Broker · Stockbit');
});
