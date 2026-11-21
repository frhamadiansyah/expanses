import { expect, type Locator, type Page } from '@playwright/test';
import { openSettings } from './accounts';
import { openAsset } from './asset-page';

export type TradeDoing = 'buy' | 'sell' | 'income' | 'units';

/** The holding page's round button for each: a payment is named by what the holding pays (Dividend, Coupon, Income). */
const BUTTON: Record<Exclude<TradeDoing, 'units'>, string | RegExp> = { buy: 'Buy', sell: 'Sell', income: /^(Dividend|Coupon|Income)$/ };

/** Income, behind the Assets corner: a year of dividends and coupons, month by month, and who pays it. */
export const INCOME = '/net-worth/investments/dividends';
/** All trades, from the foot of Assets' Investments: every holding's buys and sells by day. */
export const ALL_TRADES = '/net-worth/investments/trades';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What to do on a holding, from its own page: its round button (Buy, Sell, the payment), or — for a change of units
 * with no money, a split or bonus shares — the row under Prices in its Settings. `holding` is the start of the name
 * the Assets list gives it ("BBRI", "Antam gold bars").
 */
async function startOn(page: Page, doing: TradeDoing, holding: string) {
  await openAsset(page, holding);
  if (doing === 'units') {
    await openSettings(page);
    await page.getByRole('button', { name: /^(Shares|Units|Grams) changed/ }).click();
    return;
  }
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: BUTTON[doing], exact: true }).click();
}

/** The sheet the full trade form sits in: the one dialog whose ✓ is Record (Save changes on an edit). */
export const tradeForm = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^(Record|Save changes)$/ }) });

/**
 * The holding's own page, then what to do on it: the full form, open in a sheet. Only for a holding with no short sheet
 * of its own — gold, a fund and a listed share buy and sell in theirs (`openShortTrade`), whose details are in the same
 * sheet; their payment and a change of units still open the full form.
 */
export async function openTradeForm(page: Page, doing: TradeDoing, holding: string): Promise<Locator> {
  await startOn(page, doing, holding);
  const form = tradeForm(page);
  await expect(form).toBeVisible();
  return form;
}

/** The short Buy / Sell sheet of gold, a fund or a listed share: the one dialog with its Record buy / Record sell. */
export const shortTrade = (page: Page, doing: 'buy' | 'sell'): Locator =>
  page.getByRole('dialog').filter({ has: page.getByRole('button', { name: doing === 'buy' ? 'Record buy' : 'Record sell', exact: true }) });

/** The holding's own page, with its short Buy / Sell sheet up. */
export async function openShortTrade(page: Page, doing: 'buy' | 'sell', holding: string): Promise<Locator> {
  await startOn(page, doing, holding);
  const sheet = shortTrade(page, doing);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The trade's account row ("Paid with" or "Received into"), and the account picked from its list. */
export async function pickTradeCash(page: Page, sheet: Locator, row: 'Payment method' | 'Received into', account: string) {
  await sheet.getByRole('button', { name: new RegExp(`^${row}`) }).click();
  const list = page.getByRole('dialog', { name: row, exact: true });
  await list.getByRole('button', { name: new RegExp(`^${escape(account)}`) }).first().click();
  await expect(list).toHaveCount(0);
}

/** "Add more details" under the sheet's card: the second card, in the same sheet, with the Fee in it. */
export async function openTradeDetails(sheet: Locator) {
  await sheet.getByRole('button', { name: 'Add more details' }).click();
  await expect(sheet.getByLabel(/^Fee( \([A-Z]{3}\))?$/)).toBeVisible();
}

/** Record buy / Record sell, and wait for the short sheet to close: it closes on a saved trade only. */
export async function recordShortTrade(page: Page, doing: 'buy' | 'sell') {
  const sheet = shortTrade(page, doing);
  await page.getByRole('button', { name: doing === 'buy' ? 'Record buy' : 'Record sell', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** Record — the sheet's ✓ — and wait for the sheet to close: it closes on a saved trade only. */
export async function recordTrade(page: Page, button = 'Record') {
  const form = tradeForm(page);
  await form.getByRole('button', { name: button, exact: true }).click();
  await expect(form).toHaveCount(0);
}

/** A line of All trades, by its title ("Bought Antam gold bars", "Sold AAPL · Stockbit"). */
export const tradeRow = (page: Page, title: string | RegExp) => page.getByTestId('trade-row').filter({ hasText: title });

/**
 * A recorded trade's ⋮, the way a reader reaches it: All trades' line for it (the first with `title`, and `also` when
 * given) opens its holding's page, and the line of that page's history matching `line` ("Bought 2 g", "Dividend")
 * opens its sheet — Goals…, Reinvested…, Edit and Delete.
 */
export async function openTradeRow(page: Page, title: string | RegExp, line: RegExp, also?: string | RegExp): Promise<Locator> {
  await page.goto(ALL_TRADES);
  const row = tradeRow(page, title);
  await (also === undefined ? row : row.filter({ hasText: also })).first().click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  await page.getByRole('button', { name: new RegExp(`^More for ${line.source}`) }).first().click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Delete' }) });
  await expect(sheet).toBeVisible();
  return sheet;
}
