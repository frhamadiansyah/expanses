import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { answerSource, inject, notice, picture, screen } from './capture';
import { expectBalance } from './deposit-maturity';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The captures are dated 30 September; the app's month is the clock's, so the clock is pinned to that day.
  await page.clock.setSystemTime(new Date('2026-09-30T12:00:00+07:00'));
});

test('a notification becomes a draft the owner files, and recording it leaves a transaction', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday bank', balance: '50000000' });
  await page.goto('/review');
  await inject(page, [notice()]);

  // Nothing a reader makes of a capture reaches the ledger on its own: the payment waits in the queue at the figure
  // the notification printed. (The door it came through and the app that said it are the phone row's own words —
  // see phone-capture.spec.ts.)
  const row = page.getByTestId('draft-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('TOKO KOPI');
  await expect(row).toContainText('38.000');
  await expect(row).toContainText('2026-09-30');

  // Whose money it was is the one thing a notification cannot know, and the row asks it. Recording before the
  // question is answered is refused, in the ledger's own words, rather than filed against nothing.
  const paidWith = page.getByLabel('Account for TOKO KOPI');
  await expect(paidWith).toHaveValue('');
  await page.getByRole('button', { name: 'Record TOKO KOPI' }).click();
  await expect(page.getByRole('alert')).toContainText('Say which account paid before confirming');
  await paidWith.selectOption({ label: 'Everyday bank (IDR)' });
  await page.getByLabel('Category for TOKO KOPI').selectOption({ label: 'Groceries' });
  await page.getByRole('button', { name: 'Record TOKO KOPI' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);

  // Recorded where it belongs: the merchant is the transaction's own name, at the figure the notification printed.
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'TOKO KOPI' })).toContainText('38.000');
});

test('the same payment caught by a screenshot minutes later stays one draft', async ({ page }) => {
  await page.goto('/review');
  await inject(page, [notice()]);
  await expect(page.getByTestId('draft-row')).toHaveCount(1);

  // Two minutes later the same payment is caught again, this time as a screenshot of the app.
  await inject(page, [screen()], picture('captures/shot-1.png'));

  // Two sightings, one payment: the queue has one row for it, not two. (The row says "seen in two captures" on a
  // phone, where rows have room for the words — see phone-capture.spec.ts.)
  const row = page.getByTestId('draft-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('TOKO KOPI');
  await expect(row).toContainText('38.000');
});

test('a payment out and a top-up in are one transfer, and recording it moves both accounts', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday bank', balance: '50000000' });
  await openAccount(page, { subtype: 'ewallet', name: 'Pay wallet', balance: '1000000' });

  // One capture from each app first: answering an app says whose money its words are about, which is what makes a
  // later pair of sightings two sides of one movement rather than two payments.
  await page.goto('/review');
  await inject(page, [
    notice({ id: 'note-seed-bank', app: 'com.example.bank', title: 'Bank', body: 'Pembayaran Rp1.000 berhasil. Merchant: SEED OUT' }),
    notice({ id: 'note-seed-pay', body: 'Top up saldo Rp2.000 berhasil', capturedAt: '2026-09-30T09:00:00+07:00' }),
  ]);
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  await answerSource(page, 'Bank', 'Everyday bank');
  await answerSource(page, 'Pay', 'Pay wallet');

  await page.goto('/review');
  await inject(page, [
    notice({ id: 'note-out', app: 'com.example.bank', title: 'Bank', body: 'Pembayaran Rp200.000 berhasil. Merchant: PAY WALLET', capturedAt: '2026-09-30T09:40:00+07:00' }),
    notice({ id: 'note-topup', body: 'Top up saldo Rp200.000 berhasil', capturedAt: '2026-09-30T10:30:00+07:00' }),
  ]);

  // Out of the bank and into the wallet is one movement: the halves pair, and the row keeps both captures.
  await expect(page.getByTestId('draft-row')).toHaveCount(3);
  const transfer = page.getByTestId('draft-row').filter({ hasText: '200.000' });
  await expect(transfer).toHaveCount(1);
  await expect(transfer).toContainText('Seen in 2 captures');
  await transfer.getByRole('button', { name: /^Record / }).click();

  // Nothing was asked. A movement between the owner's own accounts is no spending, so no goal has a question to put
  // to it — the row simply goes, and the one that is left is the two seed captures waiting for their own answers.
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Both sides moved: the money left the bank and arrived in the wallet.
  await expectBalance(page, 'Everyday bank', '49.800.000');
  await expectBalance(page, 'Pay wallet', '1.200.000');

  // Seen again minutes after it was captured — the same movement the owner has just dealt with — is not a second
  // thing to do: the queue stays as it was, rather than nagging about a transfer that is already in the ledger.
  await page.goto('/review');
  await inject(page, [
    notice({ id: 'note-out-again', app: 'com.example.bank', title: 'Bank', body: 'Pembayaran Rp200.000 berhasil. Merchant: PAY WALLET', capturedAt: '2026-09-30T09:43:00+07:00' }),
  ]);
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  await expect(page.getByTestId('skipped-row')).toHaveCount(0);

  // The same figure paid again hours later is a new payment, however soon after the first was recorded: it waits.
  await inject(page, [
    notice({ id: 'note-out-later', app: 'com.example.bank', title: 'Bank', body: 'Pembayaran Rp200.000 berhasil. Merchant: PAY WALLET', capturedAt: '2026-09-30T12:05:00+07:00' }),
  ]);
  await expect(page.getByTestId('draft-row')).toHaveCount(3);
});

test('an offer is skipped rather than queued, and can be brought back', async ({ page }) => {
  await page.goto('/review');
  await inject(page, [notice({ id: 'note-promo', body: 'Cashback voucher Rp10.000 untuk kamu' })]);

  // Not a payment: nothing waits in the queue, and the foot of the page keeps it, with the way back.
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(page.getByText('Skipped (1)')).toBeVisible();
  const skipped = page.getByTestId('skipped-row');
  await expect(skipped).toContainText('Looked like an offer');
  await skipped.click();

  // Bringing it back overrules the filter for this one capture: it becomes the draft it would have been, at the
  // figure it printed.
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(page.getByTestId('draft-row')).toContainText('10.000');
  await expect(page.getByText('Skipped (1)')).toHaveCount(0);
});
