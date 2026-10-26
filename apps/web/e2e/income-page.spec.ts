import { expect, type Page, test } from '@playwright/test';
import { openSettings } from './accounts';
import { addPriced, openAsset } from './asset-page';
import { addHoldingFlow } from './securities';
import { ALL_TRADES, INCOME, recordTrade, tradeRow } from './trades';

/*
 * Buy & sell is folded away (owner, 23 Oct): what only it did lives elsewhere now. Income (behind the Assets corner)
 * reads the dividends and coupons alone — `dividends.spec.ts` walks it; All trades reads what the year's sells realized
 * and every holding's trades, a line of which opens its holding; a split or bonus shares is recorded from the
 * holding's Settings. A trade's goal and a payment's reinvested part are set from the line's ⋮ on the holding's page —
 * `goals.spec.ts` and `income-treatment.spec.ts` walk those two.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Trades recorded by these tests are dated this year, so this is the year that holds them. */
const YEAR = new Date().getFullYear();

/** A listed share owned before the app: 100 lots of BBRI, paid from Opening Balances. */
async function addStock(page: Page) {
  await addHoldingFlow(page, { search: 'BBRI', pick: 'BBRI', broker: { new: 'Stockbit' }, quantity: '100', price: '4.000', paidFrom: 'Owned before this app', date: `${YEAR}-01-05` });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBRI' })).toBeVisible();
}

test('Income keeps to dividends; All trades, off Assets, reads the year’s realized figure, shows one holding at a time and opens it; the old Buy & sell address lands there', async ({ page }) => {
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2026-03-09', '10', '18000000']]);
  await addPriced(page, 'Government bonds', 'ORI026', [['2026-01-15', '10000000', '10000000']]);

  // Income: no trade figures and no trades — gold and a bond without coupon terms pay nothing it can read.
  await page.goto(INCOME);
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expect(page.getByText('Realized this year')).toHaveCount(0);
  await expect(page.getByText('Income this year')).toHaveCount(0);
  await expect(page.getByTestId('trade-history')).toHaveCount(0);

  // All trades is the line closing Assets' Investments, drawn as the kinds above it, with no count under it.
  await page.goto('/net-worth/assets');
  await expect(page.getByTestId('all-trades')).toContainText('All trades');
  await expect(page.getByTestId('all-trades')).not.toContainText('this year');
  await page.getByTestId('all-trades').click();
  await expect(page).toHaveURL(new RegExp(`${ALL_TRADES}$`));
  await expect(page.getByRole('heading', { name: 'All trades' })).toBeVisible();
  // What the year's sells realized sits above the list, nothing yet, with its ⓘ saying what it counts.
  await expect(page.getByLabel('Realized this year', { exact: true })).toHaveText(/^Rp\s?0$/);
  await page.getByRole('button', { name: 'About Realized this year' }).click();
  await expect(page.getByText('Gains and losses from sales this year, against what the units cost.')).toBeVisible();
  // An old link or bookmark to Buy & sell lands here, not on a page that is gone.
  await page.goto('/net-worth/trades');
  await expect(page).toHaveURL(new RegExp(`${ALL_TRADES}$`));

  // Both purchases are listed, and the search shows one holding's alone.
  await expect(tradeRow(page, 'Bought Antam gold bars')).toBeVisible();
  await expect(tradeRow(page, 'Bought ORI026')).toBeVisible();
  await page.getByRole('button', { name: 'Search trades' }).click();
  await page.getByRole('searchbox', { name: 'Search trades' }).fill('ORI026');
  // The field takes the whole bar: the way back waits under it until the search is closed.
  await expect(page.getByRole('link', { name: 'Assets', exact: true })).toHaveCount(0);
  await expect(tradeRow(page, 'Bought ORI026')).toBeVisible();
  await expect(tradeRow(page, 'Bought Antam gold bars')).toHaveCount(0);
  // The round icon says it, not a word: no "opening position" and no units in the second line.
  await expect(page.getByTestId('trade-row').first()).not.toContainText('opening position');

  // A line opens its holding's own page, where a trade is changed.
  await tradeRow(page, 'Bought ORI026').click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  await expect(page.getByRole('heading', { name: 'ORI026' })).toBeVisible();
});

test('a split is recorded from a share’s Settings, under Prices, and its line is on the share’s page', async ({ page }) => {
  await addStock(page);

  // Gold and a fund say it in their own word; a share's row is the split or bonus shares.
  await openAsset(page, 'BBRI');
  await openSettings(page);
  const row = page.getByRole('button', { name: /^Shares changed/ });
  // The sentence is behind the row's ⓘ, not under it.
  await expect(page.getByText('A split or bonus shares')).toHaveCount(0);
  await page.getByRole('button', { name: 'About Shares changed' }).click();
  await expect(page.getByText('A split or bonus shares')).toBeVisible();
  await row.click();

  // The Units form, as Buy & sell's Units button opened it: a unit change, with no amount to type.
  const form = page.getByRole('dialog').filter({ has: page.getByLabel('What happened') });
  await expect(form.getByLabel('What happened')).toHaveValue('unit_change');
  // A 2-for-1 split: 10.000 shares more on the 10.000 held.
  await form.getByLabel('Units, shares or grams').fill('10000');
  await form.getByLabel('Date').fill(`${YEAR}-02-02`);
  await recordTrade(page);

  // The share's page has it, and the 100 lots are 200.
  await openAsset(page, 'BBRI');
  await expect(page.getByTestId('asset-history-row').filter({ hasText: 'Units changed' })).toContainText('100 lots');
  await expect(page.getByTestId('asset-card')).toContainText('200 lots');
  // And All trades lists it with the rest.
  await page.goto(ALL_TRADES);
  await expect(tradeRow(page, 'Units of BBRI')).toContainText('+10.000 shares');
});

test('gold has no changed-units row in Settings', async ({ page }) => {
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2026-03-09', '10', '18000000']]);
  await openAsset(page, 'Antam gold bars');
  await openSettings(page);
  await expect(page.getByRole('link', { name: 'Update prices' })).toBeVisible();
  // Gold counted in grams has no such change: grams move only by a buy or a sell.
  await expect(page.getByRole('button', { name: /^Grams changed/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Units changed/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Shares changed/ })).toHaveCount(0);
});
