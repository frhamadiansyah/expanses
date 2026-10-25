import { expect, test } from '@playwright/test';
import { openAccount, openSettings, showBalance } from './accounts';
import { openDrawers } from './drawers';
import { addHoldingFlow } from './securities';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  void page.route('https://query1.finance.yahoo.com/**', (route) => void route.abort());
});

test('a broker opened from Add holding names its RDN bank in its Settings, and its holding shows it as Custodian', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '10000000' });
  await addHoldingFlow(page, { search: 'BBRI', broker: { new: 'Stockbit' }, quantity: '5', price: '4.200', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBRI' })).toBeVisible();

  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Stockbit/ }).first().click();
  await openSettings(page);
  const bank = page.getByLabel('Bank or institution');
  await bank.fill('CIMB Niaga');
  await bank.blur();
  await expect(page.getByRole('status').filter({ hasText: 'Bank or institution saved' })).toBeAttached();

  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Stockbit/ }).first().click();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('Custodian · CIMB Niaga');
});
