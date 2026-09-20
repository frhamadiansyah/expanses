import { expect, type Locator, type Page, test } from '@playwright/test';

async function setUp(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Table' }).click();
}

async function pick(row: Locator, label: string, text: string) {
  const cell = row.getByLabel(label);
  await cell.fill(text);
  await cell.press('Enter');
}

test('rows are typed into the table, and the next purchase at the same shop guesses its category', async ({ page }) => {
  await setUp(page);
  const typing = page.getByTestId('typing-row');

  await typing.getByLabel('Row description').fill('Superindo');
  await typing.getByLabel('Row amount (IDR)').fill('450.000');
  await pick(typing, 'Row paid with', 'bca');
  await pick(typing, 'Row category', 'groceries');
  await typing.getByLabel('Row description').press('Enter');

  const recorded = page.getByTestId('table-row');
  await expect(recorded).toHaveCount(1);
  await expect(recorded.getByLabel('Row description')).toHaveValue('Superindo');
  // The account carries down to the next row; the category is worked out from the shop.
  await expect(typing.getByLabel('Row paid with')).toHaveValue('BCA Tahapan');
  await typing.getByLabel('Row description').fill('SUPERINDO Kebayoran');
  await typing.getByLabel('Row amount (IDR)').focus();
  await expect(typing.getByLabel('Row category')).toHaveValue('Groceries');

  // The view is remembered.
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('450.000');
});

test('an unfinished row waits as not recorded, and is finished in place', async ({ page }) => {
  await setUp(page);
  const typing = page.getByTestId('typing-row');

  await typing.getByLabel('Row description').fill('Apotek K24');
  await typing.getByLabel('Row amount (IDR)').fill('85000');
  await typing.getByLabel('Row amount (IDR)').press('Enter');

  const waiting = page.getByTestId('not-recorded-row');
  await expect(waiting).toHaveCount(1);
  await expect(page.getByRole('button', { name: '1 not recorded' })).toBeVisible();
  await pick(waiting, 'Row paid with', 'bca');
  await pick(waiting, 'Row category', 'pharm');
  await waiting.getByRole('button', { name: 'Record Apotek K24' }).click();

  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('table-row').getByLabel('Row description')).toHaveValue('Apotek K24');
});

test('a recorded row is corrected cell by cell and saved on its own', async ({ page }) => {
  await setUp(page);
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').fill('Superindo');
  await typing.getByLabel('Row amount (IDR)').fill('450000');
  await pick(typing, 'Row paid with', 'bca');
  await pick(typing, 'Row category', 'groceries');
  await typing.getByRole('button', { name: 'Record' }).click();

  const row = page.getByTestId('table-row');
  await row.getByLabel('Row amount (IDR)').fill('475000');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('table-row').getByLabel('Row amount (IDR)')).toHaveValue('475000');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('475.000');
});

test('rows pasted from a spreadsheet arrive as not recorded', async ({ page }) => {
  await setUp(page);
  const sheet = ['1/9\tGrab to office\t32.000\tBCA Tahapan\t', '2/9\tStarbucks\t58.000\tBCA\t'].join('\n');
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, sheet);

  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  const grab = page.getByTestId('not-recorded-row').filter({ has: page.locator('input[value="Grab to office"]') });
  await expect(grab.getByLabel('Row paid with')).toHaveValue('BCA Tahapan');
  await expect(page.getByTestId('typing-row').getByLabel('Row description')).toHaveValue('');
});

/**
 * The table's half of the ⓘ.
 *
 * Step 4 puts the receipt link in two places — the list's row and the table's — and only the list's was
 * pinned: deleting **both** `<ReceiptLink>` from `TransactionsTable.tsx` left the whole chromium project
 * green. Both slots are covered here: the editable row's, and the locked row's, which an opening balance is.
 */
test('the ⓘ opens a receipt from the table, on an editable row and on a locked one', async ({ page }) => {
  await setUp(page);
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').fill('Superindo');
  await typing.getByLabel('Row amount (IDR)').fill('450000');
  await pick(typing, 'Row paid with', 'bca');
  await pick(typing, 'Row category', 'groceries');
  await typing.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('table-row')).toHaveCount(1);

  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  await expect(page.getByRole('heading', { name: 'Superindo' })).toBeVisible();
  await expect(page.getByTestId('receipt-hero')).toContainText('450.000');

  // The locked row — an opening balance has no "Open in form", and used to have no way to a receipt either.
  // The view is remembered, so coming back to the list comes back to the table.
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Receipt for Opening balance: BCA Tahapan' }).click();
  await expect(page.getByRole('heading', { name: 'Opening balance: BCA Tahapan' })).toBeVisible();
  await expect(page.getByTestId('receipt-hero')).toContainText('20.000.000');
});
