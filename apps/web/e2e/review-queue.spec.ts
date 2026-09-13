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

  // Not money yet: the ledger has not been touched.
  await page.goto('/transactions');
  await expect(page.getByText('SUPERINDO KEBAYORAN')).toHaveCount(0);

  await page.goto('/review');
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  // The parser's guess is a starting point; the category is chosen here.
  await page.getByLabel('Category for SUPERINDO KEBAYORAN').selectOption({ label: 'Groceries' });
  await page.getByRole('button', { name: 'Record SUPERINDO KEBAYORAN' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  await page.goto('/transactions');
  await expect(page.getByText('SUPERINDO KEBAYORAN')).toBeVisible();
  // The one still waiting stayed waiting.
  await expect(page.getByText('APOTEK K24')).toHaveCount(0);
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
