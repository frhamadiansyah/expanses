import { expect, type Locator, type Page } from '@playwright/test';

export type TradeDoing = 'buy' | 'sell' | 'income' | 'units';

const BUTTON: Record<TradeDoing, string> = { buy: 'Buy', sell: 'Sell', income: 'Income', units: 'Units' };
const ASK: Record<TradeDoing, string> = { buy: 'Buy which?', sell: 'Sell which?', income: 'Income from which?', units: 'Units of which?' };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sheet the full trade form sits in: the one dialog holding "What happened". */
export const tradeForm = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.getByLabel('What happened') });

/**
 * Buy & sell's round button, then the holding (when more than one can take it): the full form, open in a sheet on the
 * holding's page. Only for a holding with no short sheet of its own — gold, a fund and a listed share buy and sell in
 * theirs (`openShortTrade`), whose details are in the same sheet. `holding` is the start of the holding's name, as the
 * picker lists it ("BBRI", "AAPL · Stockbit").
 */
export async function openTradeForm(page: Page, doing: TradeDoing, holding: string): Promise<Locator> {
  await page.goto('/net-worth/trades');
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: BUTTON[doing], exact: true }).click();
  const picker = page.getByRole('dialog', { name: ASK[doing] });
  const form = tradeForm(page);
  await expect(picker.or(form)).toBeVisible();
  if (await picker.isVisible()) {
    await picker.getByRole('button', { name: new RegExp(`^${escape(holding)}`) }).first().click();
  }
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  await expect(form).toBeVisible();
  return form;
}

/** The short Buy / Sell sheet of gold, a fund or a listed share: the one dialog with its Record buy / Record sell. */
export const shortTrade = (page: Page, doing: 'buy' | 'sell'): Locator =>
  page.getByRole('dialog').filter({ has: page.getByRole('button', { name: doing === 'buy' ? 'Record buy' : 'Record sell', exact: true }) });

/**
 * Buy & sell's round button, then the holding (when more than one can take it): the holding's own page, with its short
 * Buy / Sell sheet up.
 */
export async function openShortTrade(page: Page, doing: 'buy' | 'sell', holding: string): Promise<Locator> {
  await page.goto('/net-worth/trades');
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: BUTTON[doing], exact: true }).click();
  const picker = page.getByRole('dialog', { name: ASK[doing] });
  const sheet = shortTrade(page, doing);
  await expect(picker.or(sheet)).toBeVisible();
  if (await picker.isVisible()) {
    await picker.getByRole('button', { name: new RegExp(`^${escape(holding)}`) }).first().click();
  }
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The short sheet's account row ("Paid from" or "To"), and the account picked from its list. */
export async function pickTradeCash(page: Page, sheet: Locator, row: 'Paid from' | 'To', account: string) {
  await sheet.getByRole('button', { name: new RegExp(`^${row}`) }).click();
  const list = page.getByRole('dialog', { name: row, exact: true });
  await list.getByRole('button', { name: new RegExp(`^${escape(account)}`) }).first().click();
  await expect(list).toHaveCount(0);
}

/** "Add more details" under the short sheet's box: the second box, in the same sheet. */
export async function openTradeDetails(sheet: Locator) {
  await sheet.getByRole('button', { name: 'Add more details' }).click();
  await expect(sheet.getByLabel('Fee', { exact: true })).toBeVisible();
}

/** Record buy / Record sell, and wait for the short sheet to close: it closes on a saved trade only. */
export async function recordShortTrade(page: Page, doing: 'buy' | 'sell') {
  const sheet = shortTrade(page, doing);
  await page.getByRole('button', { name: doing === 'buy' ? 'Record buy' : 'Record sell', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

/** Record, and wait for the sheet to close: it closes on a saved trade only. */
export async function recordTrade(page: Page, button = 'Record') {
  const form = tradeForm(page);
  await form.getByRole('button', { name: button, exact: true }).click();
  await expect(form).toHaveCount(0);
}

/** A line of Buy & sell's history, by its title ("Bought Antam gold bars", "Sold AAPL · Stockbit"). */
export const tradeRow = (page: Page, title: string | RegExp) => page.getByTestId('trade-row').filter({ hasText: title });

/** A line of the history opened (the first with `title`, and `also` when given): its sheet, titled as the line is. */
export async function openTradeRow(page: Page, title: string | RegExp, also?: string | RegExp): Promise<Locator> {
  await page.goto('/net-worth/trades');
  const row = tradeRow(page, title);
  await (also === undefined ? row : row.filter({ hasText: also })).first().click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Delete' }) });
  await expect(sheet).toBeVisible();
  return sheet;
}
