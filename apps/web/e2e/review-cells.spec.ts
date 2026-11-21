import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { inject, notice } from './capture';

/*
 * Mac Review's blue cells (owner 2026-11-18): a range down a column of the queue takes one category for them all, a
 * fill down, a paste, a copy, and one Undo — each written by the table's own in-place edit. Invented captures.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-09-30T12:00:00+07:00'));
  await openAccount(page, { subtype: 'bank', name: 'Everyday bank', balance: '50000000' });
});

const row = (page: Page, description: string) => page.getByTestId('draft-row').filter({ hasText: description });
const cellOf = (r: Locator, column: string) => r.locator(`[data-cell="${column}"]`);

async function dragCells(page: Page, from: Locator, to: Locator) {
  await from.hover({ position: { x: 4, y: 4 } });
  await page.mouse.down();
  await to.hover({ position: { x: 4, y: 4 } });
  await page.mouse.up();
}

async function copyOnPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const data = new DataTransfer();
    document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
}

async function pasteOnPage(page: Page, text: string) {
  await page.evaluate((plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function threeCaptures(page: Page) {
  await page.goto('/review');
  await inject(page, [
    notice({ id: 'n-1', body: 'Pembayaran Rp21.000 berhasil. Merchant: WARUNG SATU', capturedAt: '2026-09-30T08:00:00+07:00' }),
    notice({ id: 'n-2', body: 'Pembayaran Rp22.000 berhasil. Merchant: WARUNG DUA', capturedAt: '2026-09-30T08:05:00+07:00' }),
    notice({ id: 'n-3', body: 'Pembayaran Rp23.000 berhasil. Merchant: WARUNG TIGA', capturedAt: '2026-09-30T08:10:00+07:00' }),
  ]);
  await expect(page.getByTestId('draft-row')).toHaveCount(3);
}

test('a range of category cells takes one choice for all three, and one Undo puts them back', async ({ page }) => {
  await threeCaptures(page);
  // Newest first: TIGA, DUA, SATU.
  await dragCells(page, cellOf(row(page, 'WARUNG TIGA'), 'category'), cellOf(row(page, 'WARUNG SATU'), 'category'));
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(3);
  await expect(page.getByTestId('table-note')).toContainText('3 cells');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Category for 3 captures' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 3 cells');
  for (const name of ['WARUNG SATU', 'WARUNG DUA', 'WARUNG TIGA']) await expect(row(page, name).getByRole('button', { name: `Category for ${name}` })).toHaveText('Restaurants');
  await expect(page.getByTestId('review-need-category-count')).toHaveText('0');
  expect(await copyOnPage(page)).toBe('Restaurants\nRestaurants\nRestaurants');

  await page.getByTestId('cell-change').getByRole('button', { name: 'Undo' }).click();
  // Blank again, as before: a plain blank cell (a blank category holds Record back no more).
  for (const name of ['WARUNG SATU', 'WARUNG DUA', 'WARUNG TIGA']) await expect(row(page, name).getByRole('button', { name: `Category for ${name}` })).toHaveText('');
});

test('⇧-click picks a range of amounts; a paste fills them in order, ⌘D fills down, and Delete does not discard', async ({ page }) => {
  await threeCaptures(page);
  await cellOf(row(page, 'WARUNG TIGA'), 'amount').click();
  await cellOf(row(page, 'WARUNG SATU'), 'amount').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-cell="amount"][data-picked="true"]')).toHaveCount(3);
  // The peek the first click opened steps aside for the range.
  await expect(page.getByTestId('review-peek')).toHaveCount(0);

  await pasteOnPage(page, '31.000\n32.000\n33.000');
  await expect(row(page, 'WARUNG TIGA').getByTestId('draft-amount')).toHaveText('31.000');
  await expect(row(page, 'WARUNG DUA').getByTestId('draft-amount')).toHaveText('32.000');
  await expect(row(page, 'WARUNG SATU').getByTestId('draft-amount')).toHaveText('33.000');

  await page.keyboard.press('ControlOrMeta+d');
  for (const name of ['WARUNG SATU', 'WARUNG DUA', 'WARUNG TIGA']) await expect(row(page, name).getByTestId('draft-amount')).toHaveText('31.000');

  // Delete clears the picked cells — the captures stay in the queue.
  await page.keyboard.press('Delete');
  for (const name of ['WARUNG SATU', 'WARUNG DUA', 'WARUNG TIGA']) await expect(row(page, name).getByTestId('draft-amount')).toHaveText('No amount');
  await expect(page.getByTestId('draft-row')).toHaveCount(3);
});

test('a range of Paid with cells takes one account pasted by its name, and leaves the cells outside the range', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Second bank', balance: '1000000' });
  await threeCaptures(page);
  await dragCells(page, cellOf(row(page, 'WARUNG TIGA'), 'paid'), cellOf(row(page, 'WARUNG DUA'), 'paid'));
  await expect(page.locator('[data-cell="paid"][data-picked="true"]')).toHaveCount(2);
  await pasteOnPage(page, 'Second bank');
  await expect(row(page, 'WARUNG TIGA').getByRole('button', { name: 'Account for WARUNG TIGA' })).toHaveText('Second bank');
  await expect(row(page, 'WARUNG DUA').getByRole('button', { name: 'Account for WARUNG DUA' })).toHaveText('Second bank');
  await expect(row(page, 'WARUNG SATU').getByRole('button', { name: 'Account for WARUNG SATU' })).toHaveText('Which account?');
});
