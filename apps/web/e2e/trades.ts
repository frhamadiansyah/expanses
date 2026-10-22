import { expect, type Locator, type Page } from '@playwright/test';

export type TradeDoing = 'buy' | 'sell' | 'income' | 'units';

const BUTTON: Record<TradeDoing, string> = { buy: 'Buy', sell: 'Sell', income: 'Income', units: 'Units' };
const ASK: Record<TradeDoing, string> = { buy: 'Buy which?', sell: 'Sell which?', income: 'Income from which?', units: 'Units of which?' };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sheet the full trade form sits in: the one dialog holding "What happened". */
export const tradeForm = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.getByLabel('What happened') });

/**
 * Buy & sell's round button, then the holding (when more than one can take it), then — when the holding's page opens a
 * short sheet of its own (a listed share's, a fund's, gold's) — its More options: the full form, open in a sheet on
 * the holding's page. `holding` is the start of the holding's name, as the picker lists it ("BBRI", "AAPL · Stockbit").
 */
export async function openTradeForm(page: Page, doing: TradeDoing, holding: string): Promise<Locator> {
  await page.goto('/net-worth/trades');
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: BUTTON[doing], exact: true }).click();
  const picker = page.getByRole('dialog', { name: ASK[doing] });
  const form = tradeForm(page);
  const more = page.getByRole('dialog').getByRole('button', { name: 'More options' });
  await expect(picker.or(form).or(more)).toBeVisible();
  if (await picker.isVisible()) {
    await picker.getByRole('button', { name: new RegExp(`^${escape(holding)}`) }).first().click();
    await expect(form.or(more)).toBeVisible();
  }
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  if (await more.isVisible()) await more.click();
  await expect(form).toBeVisible();
  return form;
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
