import type { RawCapture } from '@expanses/core';
import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { inject, line, notice, picture } from './capture';

/*
 * What a capture looks like where it is first read: the phone.
 *
 * The sheet is where the owner answers and corrects, and a correction is not just a fix to one draft — it is what
 * teaches the app's own layout, so the next screen of it is read where the last one was corrected.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The captures are dated 30 September; the app's month is the clock's, so the clock is pinned to that day.
  await page.clock.setSystemTime(new Date('2026-09-30T12:00:00+07:00'));
});

/**
 * One screen of a wallet app, printing another figure and another shop each time.
 *
 * The merchant line's label has no colon, which is the reader's own rule: a label is punctuated, or it is the whole
 * line. So the reader has no name for this row at all, and the owner's correction is the first thing that says where
 * the name sits.
 */
const walletScreen = (figure: string, merchant: string, over: Partial<RawCapture> = {}): RawCapture => ({
  id: `shot-${figure}`,
  kind: 'screen',
  capturedAt: '2026-09-30T09:00:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: [
    line('Pay', 0.02),
    line('Transaksi Berhasil', 0.06),
    line(`Total Rp${figure}`, 0.5, 0.04),
    line(`Merchant ${merchant}`, 0.6),
    line('Biaya Rp2.000', 0.7),
  ],
  imageFile: `captures/${figure}.png`,
  ...over,
});

test('a capture asks which account it is once, and the app remembers', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday bank', balance: '50000000' });
  await page.goto('/review');
  await inject(page, [notice()]);

  const row = page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI' });
  await expect(row).toContainText('🔔');
  await row.click();

  // The reader knew the figure and the merchant. Whose money it was is the one thing only the owner knows, and the
  // sheet asks it as a question of the app rather than of this one payment.
  const sheet = page.getByRole('dialog', { name: 'TOKO KOPI' });
  await expect(sheet.getByText('Answered once: every capture from Pay is filed there from now on.')).toBeVisible();
  await sheet.getByLabel('Which account is this?').selectOption({ label: 'Everyday bank (IDR)' });
  await sheet.getByLabel('Category').selectOption({ label: 'Groceries' });
  await sheet.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('draft-row')).toHaveCount(0);

  // The next capture from the same app is filed there without asking again.
  await inject(page, [notice({ id: 'note-2', capturedAt: '2026-09-30T11:30:00+07:00', body: 'Pembayaran Rp52.000 berhasil. Merchant: SOTO BETAWI' })]);
  await page.getByTestId('draft-row').filter({ hasText: 'SOTO BETAWI' }).click();
  const second = page.getByRole('dialog', { name: 'SOTO BETAWI' });
  await expect(second.getByText('Which account is this?')).toHaveCount(0);
  await expect(second.getByLabel('Paid with')).not.toHaveValue('');
});

test('correcting the merchant teaches the source, and the next screenshot is read from it', async ({ page }) => {
  await page.goto('/review');
  await inject(page, [walletScreen('38.000', 'TOKO KOPI MAKMUR')], picture('captures/38.000.png'));

  // No name was read, so the row is named after the screen's own first line.
  const first = page.getByTestId('draft-row').filter({ hasText: 'Pay' });
  await first.click();
  const sheet = page.getByRole('dialog', { name: 'Pay' });
  await sheet.getByLabel('Merchant').fill('TOKO KOPI MAKMUR');
  await sheet.getByLabel('Merchant').blur();

  // Correcting is also teaching: the sheet and the queue take the name, and the source is told where it was printed.
  await expect(page.getByRole('dialog', { name: 'TOKO KOPI MAKMUR' })).toBeVisible();
  await page.getByRole('dialog', { name: 'TOKO KOPI MAKMUR' }).getByRole('button', { name: 'Close' }).click();

  // The next screen of the same app is read where the correction said the name sits — no second correction needed:
  // the name the owner typed is the name the sheet now holds.
  await inject(
    page,
    [walletScreen('52.000', 'SOTO BETAWI', { id: 'shot-next', capturedAt: '2026-09-30T09:30:00+07:00' })],
    picture('captures/52.000.png'),
  );
  await page.getByTestId('draft-row').filter({ hasText: 'SOTO BETAWI' }).click();
  await expect(page.getByRole('dialog', { name: 'SOTO BETAWI' }).getByLabel('Merchant')).toHaveValue('SOTO BETAWI');
});

test('the viewer draws a box around everything it read', async ({ page }) => {
  await page.goto('/review');
  await inject(
    page,
    [
      walletScreen('38.000', 'TOKO KOPI', {
        lines: [line('Pay', 0.02), line('Transaksi Berhasil', 0.06), line('Total Rp38.000', 0.5, 0.04), line('Merchant: TOKO KOPI', 0.6)],
      }),
    ],
    picture('captures/38.000.png'),
  );

  // The picture stays one tap from the sheet, and it is where a wrong reading is easiest to see.
  await page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI' }).click();
  await page.getByRole('dialog', { name: 'TOKO KOPI' }).getByRole('button', { name: /The picture/ }).click();

  const viewer = page.getByRole('dialog', { name: 'What was read from TOKO KOPI' });
  await expect(viewer.getByText('Amount', { exact: true })).toBeVisible();
  await expect(viewer.getByText('Merchant', { exact: true })).toBeVisible();
});
