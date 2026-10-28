import { expect, type Locator, type Page } from '@playwright/test';

/** The Merchant type sheet a purchase's MCC row opens. */
export const mccSheet = (page: Page) => page.getByRole('dialog', { name: 'Merchant type' });

/** Opens the Merchant type sheet from More details' MCC row. */
export async function openMccSheet(page: Page, more: Locator) {
  await more.getByRole('button', { name: 'MCC' }).click();
  await expect(mccSheet(page)).toBeVisible();
  return mccSheet(page);
}

/** The code picked on the sheet's Code row: it opens the searchable list, where four digits and Enter choose. */
export async function chooseMccCode(page: Page, code: string) {
  await mccSheet(page).getByRole('button', { name: /^Code/ }).click();
  const find = page.getByRole('dialog', { name: 'MCC' }).getByRole('textbox', { name: 'Find an MCC' });
  await find.fill(code);
  await find.press('Enter');
  await expect(mccSheet(page).getByRole('button', { name: /^Code/ })).toContainText(code);
}

/** The merchant text remembered, typed in the Word row. */
export async function rememberWord(page: Page, word: string) {
  await mccSheet(page).getByLabel('Word', { exact: true }).fill(word);
}

/** Shuts the sheet with its ✕. */
export async function closeMccSheet(page: Page) {
  await mccSheet(page).getByRole('button', { name: 'Close' }).click();
  await expect(mccSheet(page)).toHaveCount(0);
}
