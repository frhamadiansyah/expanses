import type { Locator, Page } from '@playwright/test';

/** Sets a Currency field, whichever the form draws: the typed three-letter row, or a list to choose from. */
export async function setCurrency(field: Locator, code: string) {
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption(code);
  else await field.fill(code);
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
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${code} `) }).first().click();
  await amount.fill('');
}
