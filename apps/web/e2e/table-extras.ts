import { expect, type Locator, type Page } from '@playwright/test';

/*
 * Helpers for the Mac tables' Sheets and Notion behaviours (`table-extras*.spec.ts`). Every figure, place and account in
 * those journeys is invented.
 */

/** Pastes rows into Cashflow's typing row as ⌘V does: they wait there, and in Review alike. */
export async function pasteRows(page: Page, lines: readonly string[]) {
  await expect(page.getByTestId('typing-row').getByLabel('Row payment method')).toBeEnabled();
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate((input, plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, lines.join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(lines.length);
}

/** Records every waiting row at once (the header's Record N). */
export async function recordAll(page: Page, count: number) {
  await page.getByTestId('record-ticked').click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('transaction-row')).toHaveCount(count);
}

export const cellOf = (row: Locator, column: string) => row.locator(`[data-cell="${column}"]`);
export const recordedRow = (page: Page, note: string) => page.getByTestId('transaction-row').filter({ hasText: note });

/** Drags from one cell to another: the cells between them picked. */
export async function dragCells(page: Page, from: Locator, to: Locator) {
  await from.hover({ position: { x: 6, y: 6 } });
  await page.mouse.down();
  await to.hover({ position: { x: 8, y: 8 } });
  await page.mouse.up();
}

/** The notes of the recorded rows, top to bottom. */
export async function notes(page: Page): Promise<string[]> {
  return page.getByTestId('transaction-row').locator('[data-cell="description"]').allInnerTexts();
}

/** What ⌘C puts on the clipboard where the keyboard rests: read from the copy event the page answers. */
export async function copyHere(page: Page): Promise<string> {
  return page.evaluate(() => {
    const data = new DataTransfer();
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
}

/** ⌘V of text where the keyboard rests. */
export async function pasteHere(page: Page, text: string) {
  await page.evaluate((plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
