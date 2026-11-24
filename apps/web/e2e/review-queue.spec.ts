import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { discardDraft, pickDraftCategory, recordDraft } from './review';
import { macV2 } from './mac-detail';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The statement below is September's, and the list opens on the month the clock reads: the clock is that month's.
  await page.clock.setSystemTime(new Date('2026-09-20T12:00:00'));
});

// A bank export lists spending as negative; positive would be money coming in, and the queue would
// rightly offer income categories for it.
const CSV = ['Date,Description,Amount', '09/09/2026,SUPERINDO KEBAYORAN,-250000', '10/09/2026,APOTEK K24,-75000'].join('\n');

async function addAccount(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
}

async function loadCsv(page: Page) {
  await page.goto('/import');
  await page.getByLabel('Into account').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByRole('button', { name: /Send \d+ to review/ })).toBeVisible();
}

/** A draft row of Cashflow's table, by the note in its cell (Mac Cashflow D: a draft is finished in place there). */
const draftRow = (page: Page, description: string) =>
  page.getByTestId('not-recorded-row').filter({ has: page.locator(`input[aria-label="Row description"][value="${description}"]`) });

test('captured rows wait in the queue, and reach the ledger only when confirmed', async ({ page }) => {
  await addAccount(page);
  await loadCsv(page);

  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Nothing is recorded until confirmed there/)).toBeVisible();

  /*
   * Not money yet. On a wide screen (Mac Cashflow D) This month's To review counts the queue, and the table — the
   * editor — holds each draft as a row still to finish, among the rest, as the old table did.
   */
  await page.goto('/transactions');
  await expect(page.getByTestId('month-review')).toHaveText('2');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  // The import already guessed a category, so the row names it and can be recorded as it stands.
  const superindo = draftRow(page, 'SUPERINDO KEBAYORAN');
  // The parser guessed Miscellaneous, which is a category, so the row is complete enough to record.
  await expect(superindo.getByLabel('Row category')).toHaveValue('Miscellaneous');
  await expect(superindo.getByTestId('waiting-tick')).toHaveAttribute('data-tick', 'on');

  await page.goto('/review');
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  // The parser's guess is a starting point; the category is chosen here.
  await pickDraftCategory(page, 'SUPERINDO KEBAYORAN', 'Groceries');
  await recordDraft(page, 'SUPERINDO KEBAYORAN');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  await page.goto('/transactions');
  await expect(page.getByText('SUPERINDO KEBAYORAN')).toBeVisible();
  // The count follows the queue down — one left — and the one still waiting stayed waiting.
  await expect(page.getByTestId('month-review')).toHaveText('1');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(draftRow(page, 'APOTEK K24')).toHaveCount(1);
});

test('a discarded capture is not offered again, and never reaches the ledger', async ({ page }) => {
  await addAccount(page);
  await loadCsv(page);
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  // Wait for the write to land: navigating on the next line can abandon it in flight.
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();

  await page.goto('/review');
  await discardDraft(page, 'APOTEK K24');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  // Re-reading the same file offers nothing new: what was dealt with stays dealt with.
  await loadCsv(page);
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();
  await page.goto('/review');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  await page.goto('/transactions');
  await expect(page.getByText('APOTEK K24')).toHaveCount(0);
});

test('a capture is finished and recorded from the transactions list itself', async ({ page }) => {
  await addAccount(page);
  await loadCsv(page);
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();

  await page.goto('/transactions');
  const apotek = draftRow(page, 'APOTEK K24');
  await apotek.getByLabel('Row amount (IDR)').fill('80.000');
  // ⌘Return in its cells records it: the desk's waiting row has no Record button of its own.
  await apotek.getByLabel('Row amount (IDR)').press('ControlOrMeta+Enter');

  // Recorded, it is a row of the month like any other — and the draft beside it still waits, still counted.
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'APOTEK K24' })).toContainText('80.000');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(draftRow(page, 'SUPERINDO KEBAYORAN')).toHaveCount(1);
  await expect(page.getByTestId('month-review')).toHaveText('1');
});

test('the queue row is the way in to Review, and leaves with the last draft', async ({ page }) => {
  // The To review count as a link only while drafts wait is This month's box, a v2 part of Mac Cashflow (v1's tile is always a link).
  await macV2(page);
  await addAccount(page);
  await loadCsv(page);
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();

  await page.goto('/transactions');
  const queue = page.getByTestId('month-review');
  await expect(queue).toHaveText('2');
  // The count opens the queue's own screen, where the whole queue can be worked off.
  await queue.getByRole('link').click();
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  await pickDraftCategory(page, 'SUPERINDO KEBAYORAN', 'Groceries');
  await recordDraft(page, 'SUPERINDO KEBAYORAN');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await pickDraftCategory(page, 'APOTEK K24', 'Pharmacy');
  await recordDraft(page, 'APOTEK K24');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);

  // Nothing waiting, so the count is nought and no link — and both purchases are in the list.
  await page.goto('/transactions');
  await expect(page.getByText('SUPERINDO KEBAYORAN')).toBeVisible();
  await expect(page.getByTestId('month-review')).toHaveText('0');
  await expect(page.getByTestId('month-review').getByRole('link')).toHaveCount(0);
});
