import { expect, type Page, test } from '@playwright/test';
import { openSettings } from './accounts';
import { addPriced, openAsset } from './asset-page';
import { addHoldingFlow } from './securities';
import { ALL_TRADES, INCOME, recordTrade, tradeRow } from './trades';

/*
 * Buy & sell is folded away (owner, 23 Oct): what only it did lives elsewhere now. Income (behind the Assets corner)
 * reads the year's figures and every holding's trades, a line of which opens its holding; a split or bonus shares is
 * recorded from the holding's Settings. A trade's goal and a payment's reinvested part are set from the line's ⋮ on
 * the holding's page — `goals.spec.ts` and `income-treatment.spec.ts` walk those two.
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

test('Income reads the year; All trades, off Assets, shows one holding at a time and opens it; the old Buy & sell address lands there', async ({ page }) => {
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2026-03-09', '10', '18000000']]);
  await addPriced(page, 'Government bonds', 'ORI026', [['2026-01-15', '10000000', '10000000']]);

  // Income: the year's two figures, side by side at the top, even before anything was sold or paid — and no trades.
  await page.goto(INCOME);
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expect(page.getByTestId('trades-year')).toContainText('Realized this year');
  await expect(page.getByTestId('trades-year')).toContainText('Income this year');
  await expect(page.getByTestId('trade-history')).toHaveCount(0);

  // All trades is the row closing Assets' Investments, with this year's count.
  await page.goto('/net-worth/assets');
  await expect(page.getByTestId('all-trades')).toContainText('2 this year');
  await page.getByTestId('all-trades').click();
  await expect(page).toHaveURL(new RegExp(`${ALL_TRADES}$`));
  await expect(page.getByRole('heading', { name: 'All trades' })).toBeVisible();
  // An old link or bookmark to Buy & sell lands here, not on a page that is gone.
  await page.goto('/net-worth/trades');
  await expect(page).toHaveURL(new RegExp(`${ALL_TRADES}$`));

  // Both purchases are listed, and a chip shows one holding's alone.
  await expect(tradeRow(page, 'Bought Antam gold bars')).toBeVisible();
  await expect(tradeRow(page, 'Bought ORI026')).toBeVisible();
  const chips = page.getByRole('group', { name: 'Show' });
  await chips.getByRole('button', { name: 'ORI026', exact: true }).click();
  await expect(chips.getByRole('button', { name: 'ORI026', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(tradeRow(page, 'Bought Antam gold bars')).toHaveCount(0);

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
  await expect(row).toContainText('A split or bonus shares');
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

test('gold changes its grams from the same row, in its own words', async ({ page }) => {
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2026-03-09', '10', '18000000']]);
  await openAsset(page, 'Antam gold bars');
  await openSettings(page);
  await expect(page.getByRole('button', { name: /^Grams changed/ })).toContainText('Added or taken off, no money moving');
  await expect(page.getByRole('button', { name: /^Shares changed/ })).toHaveCount(0);
});
