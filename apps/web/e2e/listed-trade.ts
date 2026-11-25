import { expect, type Page } from '@playwright/test';
import { openAsset } from './asset-page';
import { openSettings, showBalance } from './accounts';
import { openDrawers } from './drawers';
import { routeYahoo, yahooAnswered } from './listed-prices';
import { addHoldingFlow } from './securities';

/** The custodian bank every broker here keeps its cash at, which Assets and the account's page call it by. */
export const RDN_BANK = 'CIMB Niaga';

/** A broker's cash account through Add account, with money in it. */
export async function openBroker(page: Page, broker: string, balance: string) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: /^Fund account/ }).click();
  await page.getByLabel('Broker', { exact: true }).pressSequentially(broker);
  await page.getByLabel('Custodian', { exact: true }).pressSequentially(RDN_BANK);
  await page.getByLabel('Current balance', { exact: true }).pressSequentially(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
}

/** Ten lots of BBCA owned before the app at `broker`, its last close 6.150 (from Yahoo, answered here), and its page open. */
export async function bbcaAt(page: Page, broker: string) {
  await routeYahoo(page, { close: 6_150 });
  await addHoldingFlow(page, { search: 'BBCA', broker, quantity: '10', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await yahooAnswered(page);
  await openAsset(page, 'BBCA');
  await expect(page.getByText('Rp 6.150.000').first()).toBeVisible();
}

/**
 * The broker's cash account's own page, from the Assets list: listed by its custodian bank, and — when two brokers
 * keep their cash at that bank — told apart by the broker on the line under it.
 */
async function openBrokerPage(page: Page, broker: string) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  const rows = page.getByRole('link', { name: new RegExp(`^${RDN_BANK}`) });
  await expect(rows.first()).toBeVisible();
  await ((await rows.count()) > 1 ? rows.filter({ hasText: broker }) : rows).first().click();
  await expect(page.getByRole('heading', { name: RDN_BANK })).toBeVisible();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText(`Broker · ${broker}`);
}

/** What the broker's cash account holds now, on its page. */
export async function expectBrokerBalance(page: Page, broker: string, figure: string) {
  await openBrokerPage(page, broker);
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText(figure);
}

/** The broker's cash account's settings, from its own page's ⋯. */
export async function openBrokerSettings(page: Page, broker: string) {
  await openBrokerPage(page, broker);
  await openSettings(page);
  await expect(page.getByRole('heading', { name: 'Fees' })).toBeVisible();
}
