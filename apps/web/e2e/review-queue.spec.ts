import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

// A bank export lists spending as negative; positive would be money coming in, and the queue would
// rightly offer income categories for it.
const CSV = ['Date,Description,Amount', '09/09/2026,SUPERINDO KEBAYORAN,-250000', '10/09/2026,APOTEK K24,-75000'].join('\n');

async function addAccount(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function loadCsv(page: Page) {
  await page.goto('/import');
  await page.getByLabel('Into account').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByRole('button', { name: /Send \d+ to review/ })).toBeVisible();
}

test('captured rows wait in the queue, and reach the ledger only when confirmed', async ({ page }) => {
  await addAccount(page);
  await loadCsv(page);

  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Nothing is recorded until you confirm it there/)).toBeVisible();

  // Not money yet: the list shows it, marked as not recorded, whichever month is open.
  await page.goto('/transactions');
  /*
   * The queue's row sits above the list with the count and what recording it all would spend — and the list under
   * it holds only what was recorded. A draft is not a transaction; Not recorded is how the list is asked for it.
   */
  const queue = page.getByTestId('not-recorded-card');
  await expect(queue).toContainText('Review transactions');
  await expect(queue).toContainText('2 not recorded');
  await expect(queue).toContainText('325.000');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await page.getByRole('button', { name: '2 not recorded' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  // The import already guessed a category, so the row names it and can be recorded as it stands.
  const superindo = page.getByTestId('not-recorded-row').filter({ hasText: 'SUPERINDO KEBAYORAN' });
  // The parser guessed Miscellaneous, which is a category, so the row is complete enough to record.
  await expect(superindo).toContainText('Miscellaneous');
  await superindo.click();
  const editor = page.getByTestId('not-recorded-row').filter({ has: page.getByRole('button', { name: 'Close without saving' }) });
  await expect(editor.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Close without saving' }).click();

  await page.goto('/review');
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  // The parser's guess is a starting point; the category is chosen here.
  await page.getByLabel('Category for SUPERINDO KEBAYORAN').selectOption({ label: 'Groceries' });
  await page.getByRole('button', { name: 'Record SUPERINDO KEBAYORAN' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  await page.goto('/transactions');
  await expect(page.getByText('SUPERINDO KEBAYORAN')).toBeVisible();
  // The row follows the queue down — one left, and its figure — and the one still waiting stayed waiting.
  await expect(page.getByTestId('not-recorded-card')).toContainText('1 not recorded');
  await expect(page.getByTestId('not-recorded-card')).toContainText('75.000');
  await page.getByRole('button', { name: '1 not recorded' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(page.getByTestId('not-recorded-row')).toContainText('APOTEK K24');
});

test('a discarded capture is not offered again, and never reaches the ledger', async ({ page }) => {
  await addAccount(page);
  await loadCsv(page);
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  // Wait for the write to land: navigating on the next line can abandon it in flight.
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();

  await page.goto('/review');
  await page.getByRole('button', { name: 'Discard APOTEK K24' }).click();
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
  await page.getByRole('button', { name: '2 not recorded' }).click();
  await page.getByTestId('not-recorded-row').filter({ hasText: 'APOTEK K24' }).click();
  await page.getByLabel('Row amount (IDR)').fill('80.000');
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  // Pressing the chip again shows everything: the recorded row, and the one still waiting beside it.
  await page.getByRole('button', { name: '1 not recorded' }).click();
  await expect(page.locator('li', { hasText: 'APOTEK K24' })).toContainText('80.000');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(page.getByTestId('not-recorded-row')).toContainText('SUPERINDO KEBAYORAN');
});

test('the queue row is the way in to Review, and leaves with the last draft', async ({ page }) => {
  await addAccount(page);
  await loadCsv(page);
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();

  await page.goto('/transactions');
  const queue = page.getByTestId('not-recorded-card');
  await expect(queue).toContainText('Review transactions');
  await expect(queue).toContainText('2 not recorded');
  // The row opens the queue's own screen, where the whole queue can be worked off.
  await queue.click();
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  await page.getByLabel('Category for SUPERINDO KEBAYORAN').selectOption({ label: 'Groceries' });
  await page.getByRole('button', { name: 'Record SUPERINDO KEBAYORAN' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await page.getByLabel('Category for APOTEK K24').selectOption({ label: 'Pharmacy' });
  await page.getByRole('button', { name: 'Record APOTEK K24' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);

  // Nothing waiting, so the row says nothing — and both purchases are in the list.
  await page.goto('/transactions');
  await expect(page.getByText('SUPERINDO KEBAYORAN')).toBeVisible();
  await expect(page.getByTestId('not-recorded-card')).toHaveCount(0);
});
