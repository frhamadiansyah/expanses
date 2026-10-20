import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
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
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const bank = page.getByLabel('Nama bank/institusi');
  await expect(page.getByText('4 still missing')).toBeVisible();
  await bank.fill('CIMB Niaga');
  await bank.blur();
  // Saved: the kas row has one field fewer to fill.
  await expect(page.getByText('3 still missing')).toBeVisible();

  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Stockbit/ }).first().click();
  await expect(page.getByTestId('balance-card')).toContainText('Custodian · CIMB Niaga');
});
