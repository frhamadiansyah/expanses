import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { inject, notice } from './capture';
import { draftRow, pickDraftAccount, pickDraftCategory } from './review';
import { doubleClickInPlace } from './desk-double-click';
import { macV2 } from './mac-detail';

/*
 * Review on a wide screen (Mac Review): the counts, the queue as Cashflow's waiting rows typed in place, ⌘Return /
 * Record N ready / ⌫ through Review's own paths, and the side peek with what was captured. Invented captures.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The captures are dated 30 September; the app's month is the clock's, so the clock is pinned to that day.
  await page.clock.setSystemTime(new Date('2026-09-30T12:00:00+07:00'));
  await openAccount(page, { subtype: 'bank', name: 'Everyday bank', balance: '50000000' });
});

const row = draftRow;
const count = (page: Page, id: string) => page.getByTestId(`${id}-count`);
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });
const sidebarReview = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Review/ });

/** The first capture from the Pay app, its account answered in place: every later one from the app arrives with it. */
async function answeredSource(page: Page) {
  await page.goto('/review');
  await inject(page, [notice({ id: 'note-seed', body: 'Pembayaran Rp1.000 berhasil. Merchant: SEED SHOP', capturedAt: '2026-09-30T08:00:00+07:00' })]);
  await pickDraftAccount(page, 'SEED SHOP', 'Everyday bank');
  await expect(row(page, 'SEED SHOP')).toHaveAttribute('data-ready', 'true');
}

test('a missing account is filled in place, the row turns ready (a blank category holds nothing back), and ⌘Return records it', async ({ page }) => {
  // Reads every count of the queue, zeros included: the counts box is a v2 part of Mac Review.
  await macV2(page);
  await page.goto('/review');
  await expect(page.getByTestId('review-page')).toHaveAttribute('data-desk', 'true');
  await inject(page, [notice()]);

  // The queue's counts: one to review, and what it still needs. The sidebar's badge counts the same queue.
  const kopi = row(page, 'TOKO KOPI');
  await expect(kopi).toHaveCount(1);
  await expect(count(page, 'review-to-review')).toHaveText('1');
  await expect(count(page, 'review-ready')).toHaveText('0');
  await expect(count(page, 'review-need-category')).toHaveText('1');
  await expect(count(page, 'review-need-account')).toHaveText('1');
  await expect(sidebarReview(page)).toContainText('1');
  // Cashflow's row: no source line under the note, no time under the date, no buttons of its own.
  await expect(kopi).not.toContainText('Notification');
  await expect(kopi.getByRole('button', { name: /^(Record|Discard)/ })).toHaveCount(0);
  await expect(kopi.getByLabel('Row amount (IDR)')).toHaveValue(/^Rp\s?38\.000$/);

  // Not ready: the dashed circle, and the blank cells say their column's word in grey — no orange words.
  await expect(kopi).toHaveAttribute('data-ready', 'false');
  await expect(kopi.getByTestId('review-tick')).toHaveAttribute('data-ready', 'false');
  await expect(kopi.getByLabel('Row payment method')).toHaveValue('');
  await expect(kopi.getByLabel('Row payment method')).toHaveAttribute('placeholder', 'Payment method');
  await expect(kopi.getByLabel('Row category')).toHaveValue('');
  await expect(kopi.getByLabel('Row category')).toHaveAttribute('placeholder', 'Category');

  // The account, typed in its cell: a date, an amount and Paid with, so the row turns ready.
  await pickDraftAccount(page, 'TOKO KOPI', 'Everyday bank');
  await expect(count(page, 'review-need-account')).toHaveText('0');
  await expect(kopi).toHaveAttribute('data-ready', 'true');
  await expect(count(page, 'review-ready')).toHaveText('1');
  await expect(count(page, 'review-need-category')).toHaveText('1');

  // The category, in the phone's Select category sheet: still ready, no longer counted under No category.
  await pickDraftCategory(page, 'TOKO KOPI', 'Groceries');
  await expect(kopi).toHaveAttribute('data-ready', 'true');
  await expect(count(page, 'review-ready')).toHaveText('1');
  await expect(count(page, 'review-need-category')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Record 1', exact: true })).toBeVisible();

  // Return in a cell only ends its typing; ⌘Return records the row.
  await kopi.getByLabel('Row description').click();
  await page.keyboard.press('Enter');
  await expect(kopi.locator('[data-cell="description"]')).toHaveAttribute('data-picked', 'true');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await kopi.getByLabel('Row description').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(toast(page)).toContainText('Recorded TOKO KOPI');
  await expect(count(page, 'review-to-review')).toHaveText('0');
  await expect(sidebarReview(page)).not.toContainText('1');

  // Recorded where it belongs, and listed under Recorded.
  await page.getByRole('radio', { name: 'Recorded' }).click();
  await expect(page.getByTestId('resolved-row').filter({ hasText: 'TOKO KOPI' })).toHaveCount(1);
  // Its peek's Open transaction opens the transaction's receipt (the Mac receipt) over it; Esc goes back to the capture.
  await page.getByTestId('resolved-row').filter({ hasText: 'TOKO KOPI' }).click();
  await page.getByTestId('review-peek').getByRole('button', { name: 'Open transaction' }).click();
  const receipt = page.getByTestId('receipt-peek');
  await expect(receipt.getByTestId('peek-amount')).toHaveText(/^Rp\s38\.000$/);
  await expect(receipt.getByRole('button', { name: 'Back to TOKO KOPI' })).toBeVisible();
  await expect(page).toHaveURL(/\/review/);
  await page.keyboard.press('Escape');
  await expect(receipt).toHaveCount(0);
  await expect(page.getByTestId('review-peek')).toBeVisible();
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'TOKO KOPI' })).toContainText('38.000');
});

test('Record N ready records every ready row at once, and Undo puts them all back', async ({ page }) => {
  // Reads every count of the queue, zeros included: the counts box is a v2 part of Mac Review.
  await macV2(page);
  await answeredSource(page);
  await inject(page, [
    notice({ id: 'note-a', body: 'Pembayaran Rp45.000 berhasil. Merchant: WARUNG SATE', capturedAt: '2026-09-30T09:00:00+07:00' }),
    notice({ id: 'note-b', body: 'Pembayaran Rp120.000 berhasil. Merchant: APOTIK SEHAT', capturedAt: '2026-09-30T10:00:00+07:00' }),
  ]);
  // Answered once for the app, both arrive with their account: ready, a blank category or not.
  await expect(page.getByTestId('draft-row')).toHaveCount(3);
  await expect(count(page, 'review-need-account')).toHaveText('0');
  await pickDraftCategory(page, 'WARUNG SATE', 'Restaurants');
  await pickDraftCategory(page, 'APOTIK SEHAT', 'Groceries');
  await expect(count(page, 'review-ready')).toHaveText('3');
  await expect(count(page, 'review-need-category')).toHaveText('1');
  await expect(row(page, 'SEED SHOP')).toHaveAttribute('data-ready', 'true');

  await page.getByRole('button', { name: 'Record 3', exact: true }).click();
  await expect(toast(page)).toContainText('Recorded 3 captures');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(count(page, 'review-to-review')).toHaveText('0');
  await expect(page.getByRole('button', { name: /^Record \d+ ready$/ })).toHaveCount(0);

  // Undo takes them all back: the transactions voided, the drafts in the queue again, ready as they were — the one
  // filed under Uncategorised with its category blank again.
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(3);
  await expect(count(page, 'review-ready')).toHaveText('3');
  await expect(row(page, 'SEED SHOP').getByLabel('Row category')).toHaveValue('');
  await expect(count(page, 'review-need-category')).toHaveText('1');
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'WARUNG SATE' })).toHaveCount(0);
});

test('a capture with no category is a plain blank cell, counts as ready, and Record N ready files it under Uncategorised, where Cashflow’s filter finds it', async ({ page }) => {
  // Reads the counts box (No category among them), a v2 part of Mac Review.
  await macV2(page);
  await answeredSource(page);
  await inject(page, [notice({ id: 'note-a', body: 'Pembayaran Rp45.000 berhasil. Merchant: WARUNG SATE', capturedAt: '2026-09-30T09:00:00+07:00' })]);
  await pickDraftCategory(page, 'WARUNG SATE', 'Restaurants');

  // SEED SHOP: no category, nothing guessed. Its cell is blank, its column's word in grey — no orange — and ready.
  const seed = row(page, 'SEED SHOP');
  const cell = seed.getByLabel('Row category');
  await expect(cell).toHaveValue('');
  await expect(cell).toHaveAttribute('placeholder', 'Category');
  await expect(seed).toHaveAttribute('data-ready', 'true');
  await expect(count(page, 'review-ready')).toHaveText('2');
  await expect(page.getByTestId('review-need-category')).toContainText('No category');
  await expect(count(page, 'review-need-category')).toHaveText('1');
  await expect(count(page, 'review-need-category')).not.toHaveClass(/ph-warn/);

  await page.getByRole('button', { name: 'Record 2', exact: true }).click();
  await expect(toast(page)).toContainText('Recorded 2 captures');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);

  // In Cashflow it sits under Uncategorised, and the Filter's "Waiting for a category" lists it alone.
  await page.goto('/transactions');
  const recorded = page.getByTestId('transaction-row').filter({ hasText: 'SEED SHOP' });
  await expect(recorded.locator('[data-cell="category"]')).toHaveText('Uncategorised');
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByLabel('Waiting for a category (1)').check();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await expect(page.getByTestId('transaction-row')).toContainText('SEED SHOP');
});

test('⌫ on a row takes it out of the queue for good, with Undo on the toast', async ({ page }) => {
  await page.goto('/review');
  await inject(page, [notice(), notice({ id: 'note-2', body: 'Pembayaran Rp15.000 berhasil. Merchant: PARKIR MALL', capturedAt: '2026-09-30T11:00:00+07:00' })]);
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  await row(page, 'PARKIR MALL').getByTestId('review-tick').click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(toast(page)).toContainText('Discarded PARKIR MALL');
  await expect(count(page, 'review-to-review')).toHaveText('1');

  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  await row(page, 'PARKIR MALL').getByTestId('review-tick').click();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  // Kept as discarded, so the same capture is not offered again.
  await page.getByRole('radio', { name: 'Discarded' }).click();
  await expect(page.getByTestId('resolved-row').filter({ hasText: 'PARKIR MALL' })).toHaveCount(1);
});

test('a row’s peek shows what was captured, steps with the arrows, and ⌘Return records, ⌫ discards', async ({ page }) => {
  await answeredSource(page);
  await inject(page, [notice({ id: 'note-a', body: 'Pembayaran Rp45.000 berhasil. Merchant: WARUNG SATE', capturedAt: '2026-09-30T09:00:00+07:00' })]);
  await pickDraftCategory(page, 'WARUNG SATE', 'Restaurants');

  // Newest first: WARUNG SATE (09:00) above SEED SHOP (08:00).
  // A click on the row (its circle: a click in a cell types there too) opens what was captured.
  await row(page, 'WARUNG SATE').getByTestId('review-tick').click();
  const peek = page.getByTestId('review-peek');
  await expect(peek).toBeVisible();
  await expect(peek.getByTestId('peek-title')).toHaveText('WARUNG SATE');
  await expect(peek.getByTestId('peek-amount')).toHaveText(/^Rp\s45\.000$/);
  await expect(peek.getByTestId('peek-when')).toContainText('from a notification');
  // The message's own words, as they arrived.
  await expect(peek.getByTestId('peek-captured')).toContainText('Pembayaran Rp45.000 berhasil. Merchant: WARUNG SATE');

  // ⌄ to the next capture, ⌃ back.
  await page.keyboard.press('ArrowDown');
  await expect(peek.getByTestId('peek-title')).toHaveText('SEED SHOP');
  await expect(peek.getByTestId('peek-captured')).toContainText('Merchant: SEED SHOP');
  await page.keyboard.press('ArrowUp');
  await expect(peek.getByTestId('peek-title')).toHaveText('WARUNG SATE');

  // A field changed in the peek is the draft's at once: the row follows.
  await peek.getByLabel('Description').fill('Sate Pak Kumis');
  await peek.getByLabel('Description').press('Enter');
  await expect(row(page, 'Sate Pak Kumis')).toHaveCount(1);
  await expect(peek.getByTestId('peek-title')).toHaveText('Sate Pak Kumis');

  // ⌘Return records the peeked row (Return alone does not); the peek moves on to the row that took its place.
  await peek.getByTestId('peek-title').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(toast(page)).toContainText('Recorded Sate Pak Kumis');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(peek.getByTestId('peek-title')).toHaveText('SEED SHOP');

  // ⌫ discards SEED SHOP.
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(peek).toHaveCount(0);

  await inject(page, [notice({ id: 'note-b', body: 'Pembayaran Rp52.000 berhasil. Merchant: BAKSO MALANG', capturedAt: '2026-09-30T10:00:00+07:00' })]);
  // A double-click opens the row's form, even when the peek its first click opened (a 1280 window making room for it)
  // moved the row from under the pointer.
  // On its circle: a double-click in a cell picks a word there.
  await doubleClickInPlace(page, row(page, 'BAKSO MALANG').getByTestId('review-tick'));
  await expect(page.getByRole('form', { name: 'Review BAKSO MALANG' })).toBeVisible();
});

test('the queue’s count is the sidebar’s and Cashflow’s To review', async ({ page }) => {
  await page.goto('/review');
  await inject(page, [notice(), notice({ id: 'note-2', body: 'Pembayaran Rp15.000 berhasil. Merchant: PARKIR MALL', capturedAt: '2026-09-30T11:00:00+07:00' })]);
  await expect(count(page, 'review-to-review')).toHaveText('2');
  await expect(sidebarReview(page)).toContainText('2');
  await page.goto('/transactions');
  await expect(page.getByTestId('month-review')).toHaveText('2');
});
