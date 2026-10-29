import type { Page } from '@playwright/test';

/** A purchase's row on a card's Purchases list: the category's name, the note and date, the amount and the points. */
export const purchaseRowOf = (page: Page, description: string) => page.getByTestId('purchase').filter({ hasText: description });

/**
 * Taps a purchase and returns the sheet that opens: its category, MCC, estimate and the field for what the bank credited.
 * The sheet is named for the purchase's note.
 */
export async function openPurchase(page: Page, description: string) {
  await purchaseRowOf(page, description).first().click();
  return page.getByRole('dialog', { name: description });
}

/** Closes the purchase sheet again. */
export async function closePurchase(page: Page, description: string) {
  await page.getByRole('dialog', { name: description }).getByRole('button', { name: 'Close' }).click();
}
