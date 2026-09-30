import { expect, test } from '@playwright/test';
import { openDrawers } from './drawers';

test('by thumb: the broker and the RDN bank are picked from what the keyboard offers', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Fund account/ }).tap();
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await page.getByLabel('Broker', { exact: true }).tap();
  await page.getByLabel('Broker', { exact: true }).pressSequentially('Mi');
  await page.getByRole('listbox', { name: 'Brokers' }).getByRole('option', { name: 'Mirae Asset Sekuritas' }).click();
  await expect(page.getByLabel('Broker', { exact: true })).toHaveValue('Mirae Asset Sekuritas');
  await page.getByLabel('RDN bank', { exact: true }).tap();
  await page.getByLabel('RDN bank', { exact: true }).pressSequentially('cimb');
  await page.getByRole('listbox', { name: 'Banks' }).getByRole('option', { name: 'CIMB Niaga' }).click();
  await page.getByLabel('Balance now', { exact: true }).pressSequentially('8000000');
  await page.getByRole('button', { name: 'Add account' }).tap();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Mirae Asset Sekuritas/ }).first().tap();
  await expect(page.getByTestId('balance-card')).toContainText('RDN at CIMB Niaga');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
