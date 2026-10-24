import type { Locator } from '@playwright/test';

/**
 * Pastes text into a field the way a long-press Paste does: a paste event carrying the text, which the field may take
 * over. `fill` types instead, and a field's own length limit cuts typed text from its start — the very thing a field
 * that keeps the end of a pasted number has to be checked against.
 */
export async function pasteInto(field: Locator, text: string) {
  await field.focus();
  await field.evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData('text/plain', pasted);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}
