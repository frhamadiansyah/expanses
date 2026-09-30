import { expect, type Page } from '@playwright/test';
import { openAsset } from './asset-page';
import { openSettings } from './accounts';
import { openDrawers } from './drawers';
import { routeYahoo } from './listed-prices';
import { addHoldingFlow } from './securities';

/** A broker's cash account through Add account, with money in it. */
export async function openBroker(page: Page, broker: string, balance: string) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Fund account/ }).click();
  await page.getByLabel('Broker', { exact: true }).pressSequentially(broker);
  await page.getByLabel('RDN bank', { exact: true }).pressSequentially('CIMB Niaga');
  await page.getByLabel('Balance now', { exact: true }).pressSequentially(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
}

/** Ten lots of BBCA owned before the app at `broker`, its last close 6.150 (from Yahoo, answered here), and its page open. */
export async function bbcaAt(page: Page, broker: string) {
  await routeYahoo(page, { close: 6_150 });
  await addHoldingFlow(page, { search: 'BBCA', broker, quantity: '10', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await openAsset(page, 'BBCA');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
}

/** The broker's cash account's own page, from the Assets list. */
async function openBrokerPage(page: Page, broker: string) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: new RegExp(`^${broker}`) }).first().click();
  await expect(page.getByRole('heading', { name: broker })).toBeVisible();
}

/** What the broker's cash account holds now, on its page. */
export async function expectBrokerBalance(page: Page, broker: string, figure: string) {
  await openBrokerPage(page, broker);
  await expect(page.getByTestId('balance-card')).toContainText(figure);
}

/** The broker's cash account's settings, from its own page's ⋯. */
export async function openBrokerSettings(page: Page, broker: string) {
  await openBrokerPage(page, broker);
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Fees' })).toBeVisible();
}
