import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount, openAccountHistory } from './accounts';
import { openRowPeek } from './receipt-peek';

/*
 * Cashflow on a wide screen is the table (Mac Cashflow D, option E): the month's rows oldest first, read only (a click
 * opens the side peek, a double-click the edit screen), the rows waiting to be recorded, then the typing row last. Correcting a recorded row cell by cell is the table an
 * account's own history keeps, behind its Table switch.
 */
async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
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

  const recorded = page.getByTestId('transaction-row');
  await expect(recorded).toHaveCount(1);
  await expect(recorded).toContainText('Superindo');
  // The account carries down to the next row; the category is worked out from the shop.
  await expect(typing.getByLabel('Row paid with')).toHaveValue('BCA Tahapan');
  await typing.getByLabel('Row description').fill('SUPERINDO Kebayoran');
  await typing.getByLabel('Row amount (IDR)').focus();
  await expect(typing.getByLabel('Row category')).toHaveValue('Groceries');

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
  // It waits here, in Cashflow's table, not in Review: This month's To review counts captures only.
  await expect(page.getByTestId('month-review')).toHaveText('0');
  await pick(waiting, 'Row paid with', 'bca');
  await pick(waiting, 'Row category', 'pharm');
  await waiting.getByRole('button', { name: 'Record Apotek K24' }).click();

  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('transaction-row')).toContainText('Apotek K24');
});

test('a recorded row is corrected cell by cell on its account’s table, and saved on its own', async ({ page }) => {
  await setUp(page);
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').fill('Superindo');
  await typing.getByLabel('Row amount (IDR)').fill('450000');
  await pick(typing, 'Row paid with', 'bca');
  await pick(typing, 'Row category', 'groceries');
  await typing.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);

  // Cell by cell is the account history's table.
  await openAccountHistory(page, 'BCA Tahapan');
  await page.getByRole('button', { name: 'Table' }).click();
  const row = page.getByTestId('table-row').filter({ has: page.locator('input[value="Superindo"]') });
  await row.getByLabel('Row amount (IDR)').fill('475000');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByLabel('Row amount (IDR)')).toHaveValue('475000');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('475.000');
});

test('rows pasted from a spreadsheet arrive as not recorded', async ({ page }) => {
  // The pasted days are September's, and the table shows the month the clock reads: the clock is that month's.
  await page.clock.setSystemTime(new Date('2026-09-20T12:00:00'));
  await setUp(page);
  // In the wide table's visible order (Date, Note, Category, Paid with, Amount), which is the order a paste is read in.
  const sheet = ['1/9\tGrab to office\t\tBCA Tahapan\t32.000', '2/9\tStarbucks\t\tBCA\t58.000'].join('\n');
  // The cells read pasted names against the accounts, which are still loading while the cells wait (disabled).
  await expect(page.getByTestId('typing-row').getByLabel('Row paid with')).toBeEnabled();
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, sheet);

  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  const grab = page.getByTestId('not-recorded-row').filter({ has: page.locator('input[value="Grab to office"]') });
  await expect(grab.getByLabel('Row paid with')).toHaveValue('BCA Tahapan');
  await expect(page.getByTestId('typing-row').getByLabel('Row description')).toHaveValue('');
  await expect(grab.getByLabel('Row amount (IDR)')).toHaveValue(/^Rp\s?32\.000$/);
});

/** Pastes text into the typing row's Note cell, as ⌘V from a spreadsheet does. */
async function pasteInto(page: Page, text: string) {
  await expect(page.getByTestId('typing-row').getByLabel('Row paid with')).toBeEnabled();
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate((input, sheet) => {
    const data = new DataTransfer();
    data.setData('text/plain', sheet);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const draftRow = (page: Page, note: string) => page.getByTestId('not-recorded-row').filter({ has: page.locator(`input[value="${note}"]`) });

test('rows pasted in the table’s own column order land in the right cells, wait above the typing row, and are recorded one by one', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-11-18T12:00:00'));
  await setUp(page);
  // How to paste is said on the typing row's hover: it says nothing under itself.
  await expect(page.getByTestId('typing-row')).toHaveAttribute('title', /paste from a spreadsheet: Date · Note · Category · Paid with · Amount \(or with a header row, any order\)/);

  // Date, Note, Category, Paid with, Amount — as Sheets copies it, a Notion date and the money's name included. Invented.
  const sheet = [
    '2026-11-17\tPasar Santa\tGroceries\tBCA Tahapan\tRp 64.500',
    'Nov 16, 2026\tWarung Tegal\tRestaurants\tBCA\t38,000',
    '15/11/2026\tSomething odd\tNo such category\tBCA\t12000',
  ].join('\n');
  await pasteInto(page, sheet);
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  const pasar = draftRow(page, 'Pasar Santa');
  await expect(pasar.getByLabel('Row category')).toHaveValue('Groceries');
  await expect(pasar.getByLabel('Row paid with')).toHaveValue('BCA Tahapan');
  await expect(pasar.getByLabel('Row amount (IDR)')).toHaveValue(/^Rp\s?64\.500$/);
  await expect(pasar.getByLabel('Row date')).toHaveValue('17 Nov 2026');
  const warung = draftRow(page, 'Warung Tegal');
  await expect(warung.getByLabel('Row category')).toHaveValue('Restaurants');
  await expect(warung.getByLabel('Row amount (IDR)')).toHaveValue(/^Rp\s?38\.000$/);
  await expect(warung.getByLabel('Row date')).toHaveValue('16 Nov 2026');
  // A category it cannot find is left empty, never guessed; its Record still records it, under Uncategorised.
  await expect(draftRow(page, 'Something odd').getByLabel('Row category')).toHaveValue('');
  await expect(draftRow(page, 'Something odd').getByRole('button', { name: 'Record Something odd' })).toBeEnabled();

  await pasar.getByRole('button', { name: 'Record Pasar Santa' }).click();
  await warung.getByRole('button', { name: 'Record Warung Tegal' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);

  // A header row, in another order, names the columns; it is not kept as a row.
  await pasteInto(page, ['Amount\tKategori\tNote\tDate\tPaid with', '25.000\tGroceries\tKios buah\t17 Nov\tBCA', '9.000\tGroceries\tKios sayur\t17 Nov\tBCA'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  await expect(draftRow(page, 'Kios buah').getByLabel('Row amount (IDR)')).toHaveValue(/^Rp\s?25\.000$/);
  await expect(draftRow(page, 'Kios buah').getByLabel('Row category')).toHaveValue('Groceries');
  await expect(page.locator('input[value="Note"]')).toHaveCount(0);
  // ✕ (twice) discards a waiting row.
  await draftRow(page, 'Kios sayur').getByRole('button', { name: 'Discard' }).click();
  await draftRow(page, 'Kios sayur').getByRole('button', { name: 'Click again to discard' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
});

/**
 * The table's half of the ⓘ.
 *
 * Step 4 puts the receipt link in two places — the list's row and the table's — and only the list's was
 * pinned: deleting **both** `<ReceiptLink>` from `TransactionsTable.tsx` left the whole chromium project
 * green. Both slots are covered here: the editable row's, and the locked row's, which an opening balance is.
 */
test('a receipt opens from the table: Cashflow’s row by a click, an account’s table — editable or locked — by its ⓘ', async ({ page }) => {
  await setUp(page);
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').fill('Superindo');
  await typing.getByLabel('Row amount (IDR)').fill('450000');
  await pick(typing, 'Row paid with', 'bca');
  await pick(typing, 'Row category', 'groceries');
  await typing.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);

  // Cashflow's recorded row has no ⓘ: a click opens its receipt, the side peek.
  await expect(page.getByRole('link', { name: 'Receipt for Superindo' })).toHaveCount(0);
  const peek = await openRowPeek(page, 'Superindo');
  await expect(peek.getByTestId('peek-title')).toHaveText('Superindo');
  await expect(peek.getByTestId('peek-amount')).toContainText('450.000');

  // The locked row — an opening balance has no "Open in form", and used to have no way to a receipt either.
  // The account's history has the table too. Opening balances are shown only when
  // asked for, and only on the account's own history (Cashflow lists only money in and out, owner 2026-11-16).
  await page.evaluate(() => localStorage.setItem('transactions-show-opening', '1'));
  await openAccountHistory(page, 'BCA Tahapan');
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
  // The table's editable row keeps its ⓘ, and the locked one too; both open the peek over the list.
  await expect(page.getByRole('link', { name: 'Receipt for Superindo' })).toBeVisible();
  const locked = await openRowPeek(page, 'Opening balance: BCA Tahapan', { history: true });
  await expect(page).toHaveURL(/\/transactions\?account=/);
  await expect(locked.getByTestId('peek-title')).toHaveText('Opening balance: BCA Tahapan');
  await expect(locked.getByTestId('peek-amount')).toContainText('20.000.000');
});
