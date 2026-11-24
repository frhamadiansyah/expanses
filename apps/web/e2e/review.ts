import { expect, type Locator, type Page } from '@playwright/test';

/*
 * Mac Review's rows are Cashflow's waiting rows (owner, 2026-11-24): each cell is typed in place — Date, Note, Category,
 * Paid with, Amount — and ⌘Return records the row. A row is found by its note, which its Note cell holds.
 */

/** A capture's row in the queue, by its note. */
export const draftRow = (page: Page, description: string): Locator =>
  page.getByTestId('draft-row').filter({ has: page.locator(`input[aria-label="Row description"][value="${description}"]`) });

/** A list cell (Category, Paid with) typed toward a choice and taken with Return, which leaves the cell picked. */
async function choose(row: Locator, label: string, text: string, shown = text) {
  const cell = row.getByLabel(label);
  await expect(cell).toBeEnabled();
  await cell.fill(text);
  await cell.press('Enter');
  await expect(cell).toHaveValue(shown);
}

/** A capture's category chosen in its Category cell. */
export async function pickDraftCategory(page: Page, description: string, category: string) {
  await choose(draftRow(page, description), 'Row category', category);
}

/** A capture's account chosen in its Paid with cell (answered for the capture's source too, as the draft sheet does). */
export async function pickDraftAccount(page: Page, description: string, account: string) {
  await choose(draftRow(page, description), 'Row payment method', account);
}

/** ⌘Return in one of its cells records a capture: Review's rows, as Cashflow's, have no Record button of their own. */
export async function recordDraft(page: Page, description: string) {
  await draftRow(page, description).getByLabel('Row description').click();
  await page.keyboard.press('ControlOrMeta+Enter');
}

/** ⌫ on a capture picked by a click on its row (its circle) discards it. */
export async function discardDraft(page: Page, description: string) {
  await draftRow(page, description).getByTestId('review-tick').click();
  await page.keyboard.press('Backspace');
}
