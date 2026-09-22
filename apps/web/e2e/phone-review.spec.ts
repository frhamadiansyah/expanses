import { expect, type Locator, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

// A bank export lists spending as negative; positive would be money coming in, and the queue would
// rightly offer income categories for it.
const CSV = ['Date,Description,Amount', '09/09/2026,SUPERINDO KEBAYORAN,-250000', '10/09/2026,APOTEK K24,-75000'].join('\n');
// A card portal lists a refund as negative, and a card row that is money in is the one capture whose category
// cannot be guessed at all — the queue's own "no category yet".
const CARD_CSV = ['Date,Description,Amount', '09/09/2026,REFUND UNIQLO,-899000'].join('\n');

async function addAccount(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function addCard(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();
}

/** Into `account`, from the file, and off to Review — where every one of these specs starts. */
async function capture(page: Page, account: string, csv: string) {
  await page.goto('/import');
  await page.getByLabel('Into account').selectOption({ label: account });
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('button', { name: /Send \d+ to review/ })).toBeVisible();
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  // Wait for the write to land: navigating on the next line can abandon it in flight.
  await expect(page.getByText(/Sent \d+ rows to Review/)).toBeVisible();
}

/** Pointer down, a drag, up — the gesture, not a click. */
async function swipe(page: Page, row: Locator, to: 'left' | 'right') {
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = to === 'left' ? box.x + box.width - 12 : box.x + 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from + (to === 'left' ? -160 : 160) * (step / 10), y);
  await page.mouse.up();
}

const row = (page: Page, what: string) => page.getByTestId('draft-row').filter({ hasText: what });
/** Not any status: the install hint and the backup banner are statuses too. */
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });

test('the queue is rows, and a tap opens the sheet that records one', async ({ page }) => {
  await addAccount(page);
  await capture(page, 'BCA Tahapan (IDR)', CSV);

  await page.goto('/review');
  // No sideways table on a phone: two rows, each saying what it read and where it is headed.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  const superindo = row(page, 'SUPERINDO KEBAYORAN');
  await expect(superindo).toContainText('9 Sep · BCA Tahapan · Miscellaneous');
  await expect(superindo).toContainText('250.000');

  // A tap opens the sheet: what was read, read-only, and the two answers to give.
  await superindo.click();
  const sheet = page.getByRole('dialog', { name: 'SUPERINDO KEBAYORAN' });
  await expect(sheet.getByText('9 Sep 2026')).toBeVisible();
  await expect(sheet).toContainText('250.000');
  await sheet.getByLabel('Category').selectOption({ label: 'Groceries' });
  await sheet.getByRole('button', { name: 'Record', exact: true }).click();

  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/transactions');
  await expect(page.getByTestId('not-recorded-card')).toContainText('1 not recorded');
});

test('a swipe right records, and the toast takes it back', async ({ page }) => {
  await addAccount(page);
  await capture(page, 'BCA Tahapan (IDR)', CSV);

  await page.goto('/review');
  await swipe(page, row(page, 'SUPERINDO KEBAYORAN'), 'right');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  // The record is undoable: the transaction is voided and the draft comes back to the queue.
  await expect(toast(page)).toContainText('Recorded SUPERINDO KEBAYORAN');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(2);

  await page.goto('/transactions');
  await expect(page.getByTestId('not-recorded-card')).toContainText('2 not recorded');
});

test('a swipe left discards, and the toast brings it back', async ({ page }) => {
  await addAccount(page);
  await capture(page, 'BCA Tahapan (IDR)', CSV);

  await page.goto('/review');
  const apotek = row(page, 'APOTEK K24');
  // The action is behind the row, not inside its tap target: it is not in the accessibility tree until the row
  // has been dragged open.
  await expect(apotek.getByRole('button', { name: 'Discard APOTEK K24' })).toHaveCount(0);
  await swipe(page, apotek, 'left');
  await apotek.getByRole('button', { name: 'Discard APOTEK K24' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  await expect(toast(page)).toContainText('Discarded APOTEK K24');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
});

test('a swipe on a capture with no category opens the sheet rather than recording it', async ({ page }) => {
  await addCard(page);
  await capture(page, 'BCA Visa (IDR)', CARD_CSV);

  await page.goto('/review');
  const refund = row(page, 'REFUND UNIQLO');
  await expect(refund).toContainText('no category yet');

  // No gesture may answer a question: the sheet opens on the row, and Record stays refused until it is answered.
  await swipe(page, refund, 'right');
  const sheet = page.getByRole('dialog', { name: 'REFUND UNIQLO' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
  await expect(sheet).toContainText('Recording needs both');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
});
