import { expect, type Locator, type Page, test } from '@playwright/test';
import { addPlastic, openAccount, openCard } from './accounts';
import { cardPage } from './card-section';
import { addTransaction } from './add-transaction';
import { inject, notice } from './capture';

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
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
}

async function addCard(page: Page) {
  await openCard(page, { name: 'BCA Visa' });
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

test('the queue is rows, and a tap opens the Add form that records one', async ({ page }) => {
  await addAccount(page);
  await capture(page, 'BCA Tahapan (IDR)', CSV);

  await page.goto('/review');
  // No sideways table on a phone: two rows in day cards, each saying what it read and where it is headed.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  const superindo = row(page, 'SUPERINDO KEBAYORAN');
  // The day is the card's, as on Cashflow: a card per day, headed by its date.
  await expect(page.locator('section').filter({ has: superindo })).toContainText('September 2026');
  await expect(superindo).toContainText('250.000');

  // A tap opens the Add transaction form, filled in from what was read: the day, the figure, the account, the guess.
  await superindo.click();
  const form = page.getByRole('form', { name: 'Review SUPERINDO KEBAYORAN' });
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(form.getByLabel('Date')).toHaveValue('2026-09-09');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText('250.000');
  await expect(form.getByRole('button', { name: 'Paid with' })).toContainText('BCA Tahapan');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(toast(page)).toContainText('Recorded SUPERINDO KEBAYORAN');
  await page.goto('/transactions');
  await expect(page.getByTestId('not-recorded-card')).toContainText('1 not recorded');

  // The queue's line sits above the transaction history, not under its heading: it is not a transaction.
  await page.goto('/transactions?month=%222026-09%22');
  const history = page.getByRole('heading', { name: 'Transactions', exact: true });
  await expect(history).toBeVisible();
  const queue = (await page.getByTestId('not-recorded-card').boundingBox())!;
  expect(queue.y + queue.height).toBeLessThan((await history.boundingBox())!.y);
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

  // Mail's long swipe: most of the way across, let go, and it is discarded at once — the same toast, the same Undo.
  await page.waitForTimeout(400);
  const back = row(page, 'APOTEK K24');
  const box = (await back.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 8;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 15; step += 1) await page.mouse.move(from - (box.width * 0.85 * step) / 15, y);
  await expect(back.getByTestId('swipe-full')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(toast(page)).toContainText('Discarded APOTEK K24');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
});

test('a swipe on a capture with no category records it under Uncategorised, where Cashflow’s needs-a-category line finds it', async ({ page }) => {
  await addCard(page);
  await capture(page, 'BCA Visa (IDR)', CARD_CSV);

  await page.goto('/review');
  const refund = row(page, 'REFUND UNIQLO');
  await expect(refund).toContainText('899.000');
  await expect(refund).toContainText('Choose category');

  // A tap opens the form: money in is read as income, on the Income tab, with no category yet. Back records nothing.
  await refund.click();
  const form = page.getByRole('form', { name: 'Review REFUND UNIQLO' });
  await expect(form).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Income' })).toBeChecked();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  // Discard at the form's foot takes it out of the queue, and the toast brings it back.
  await refund.click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(toast(page)).toContainText('Discarded REFUND UNIQLO');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  // One record rule (owner 2026-11-21): a date, an amount and Paid with are there, so a swipe right records it — a
  // blank category filed under Uncategorised. Undo brings it back with its category blank again.
  await swipe(page, refund, 'right');
  await expect(toast(page)).toContainText('Recorded REFUND UNIQLO');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(refund).toContainText('Choose category');

  await swipe(page, refund, 'right');
  await expect(toast(page)).toContainText('Recorded REFUND UNIQLO');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  // Findable later: Cashflow's line of what still needs a category lists it.
  await page.goto('/transactions');
  await expect(page.getByTestId('needs-category-card')).toContainText('1 needs a category');
  await page.getByTestId('needs-category-card').click();
  await expect(page.getByText('REFUND UNIQLO').first()).toBeVisible();
});

test('the form’s own Record takes a capture with no category too, filed under Uncategorised; Undo blanks it again', async ({ page }) => {
  await addCard(page);
  await capture(page, 'BCA Visa (IDR)', CARD_CSV);

  await page.goto('/review');
  const refund = row(page, 'REFUND UNIQLO');
  await refund.click();
  const form = page.getByRole('form', { name: 'Review REFUND UNIQLO' });
  // One record rule with the swipe (owner 2026-11-21): Paid with and a figure are there, so ✓ lights with no category.
  await expect(form.getByRole('button', { name: 'Category' })).toContainText('Choose later');
  const record = page.getByRole('button', { name: 'Record', exact: true });
  await expect(record).toBeEnabled();
  await record.click();
  await expect(toast(page)).toContainText('Recorded REFUND UNIQLO');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(refund).toContainText('Choose category');

  await refund.click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(toast(page)).toContainText('Recorded REFUND UNIQLO');
  await page.goto('/transactions');
  await expect(page.getByTestId('needs-category-card')).toContainText('1 needs a category');
});

const sms = (id: string, shop: string, amount: string, time: string) =>
  notice({
    id,
    app: 'BANKCONTOH',
    title: 'BANKCONTOH',
    body: `Pembayaran berhasil kartukredit XXXX9025 tgl 30-09-2026 ${time} di ${shop} IDR${amount}. Jika trx tidak Anda kenal, hub 10000`,
  });

test('a capture whose shop has history shows that category, and a swipe right records it there', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-09-30T12:00:00+07:00'));
  await openCard(page, { name: 'Prima Platinum', bank: 'Mandiri', last4: '3317' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Mandiri Prima Platinum(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await addPlastic(page, '9025', 'Partner');
  // Filed before under a name sharing only the first word: the Add form guesses Groceries from it.
  await addTransaction(page, { description: 'Warung Bahari', paidWith: 'Mandiri Prima Platinum ···· 3317', category: 'Groceries', amount: '45000' });

  await page.goto('/review');
  await inject(page, [sms('sms-known', 'WARUNG SEDERHANA', '48.300,00', '10:15:00'), sms('sms-new', 'TOKO ASING BARU', '71.900,00', '14:40:00')]);
  const known = row(page, 'WARUNG SEDERHANA');
  await expect(known).toContainText('Groceries');
  await expect(known).not.toContainText('Choose category');
  // A shop never seen before still has its question.
  await expect(row(page, 'TOKO ASING BARU')).toContainText('Choose category');

  await swipe(page, known, 'right');
  await expect(toast(page)).toContainText('Recorded WARUNG SEDERHANA');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  await page.goto('/transactions');
  await expect(page.getByText('WARUNG SEDERHANA').first()).toBeVisible();
  await expect(page.getByText('Groceries').first()).toBeVisible();

  // The shop with no history records all the same, under Uncategorised (one record rule, owner 2026-11-21).
  await page.goto('/review');
  await swipe(page, row(page, 'TOKO ASING BARU'), 'right');
  await expect(toast(page)).toContainText('Recorded TOKO ASING BARU');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
});

test('a row pasted into Cashflow’s table on a wide screen waits in the phone’s Review too, and a swipe records it', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-10-20T12:00:00'));
  await addAccount(page);
  // Pasted where pasting is: Cashflow's table on a wide screen.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/transactions');
  const typing = page.getByTestId('typing-row');
  await expect(typing.getByLabel('Row paid with')).toBeEnabled();
  await typing.getByLabel('Row description').evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', '2026-10-16\tToko Contoh\tGroceries\tBCA Tahapan\t21.000');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review');
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(row(page, 'Toko Contoh')).toContainText('21.000');
  await swipe(page, row(page, 'Toko Contoh'), 'right');
  await expect(toast(page)).toContainText('Recorded Toko Contoh');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await page.goto('/transactions');
  await expect(page.getByTestId('not-recorded-card')).toHaveCount(0);
});
