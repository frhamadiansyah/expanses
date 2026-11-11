import type { Locator, Page } from '@playwright/test';

/** The row that opens the currency sheet: a picker row ("Currency  IDR ›") or a pocket's code button ("Pocket 1: IDR"). */
export function currencyRow(page: Page | Locator, label = 'Currency') {
  return page.getByRole('button', { name: new RegExp(`^${label}(: |, | [A-Z]{3}|$)`) });
}

/** Chooses `code` in the open currency sheet. */
export async function pickInSheet(page: Page, code: string) {
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${code} `) }).first().click();
}

/** Sets a currency by opening the sheet its row opens and choosing the code there. */
export async function setCurrency(row: Locator, code: string) {
  await row.click();
  await pickInSheet(row.page(), code);
}

/**
 * Sets a new account's currency, which is no field of its own: it is the symbol before the Current balance, drawn
 * only once a figure is typed, and a tap on it opens the currency list. So a figure is typed for it, the currency
 * picked, and the figure cleared again — the caller then types what the account opens with in its own currency
 * (a figure typed while it was still rupiah would have lost its decimals).
 */
export async function setBalanceCurrency(page: Page, code: string, within: Page | Locator = page) {
  const amount = within.getByLabel('Current balance', { exact: true });
  await amount.fill('1');
  await within.getByRole('button', { name: /^Currency: [A-Z]{3}$/ }).click();
  await pickInSheet(page, code);
  await amount.fill('');
}
