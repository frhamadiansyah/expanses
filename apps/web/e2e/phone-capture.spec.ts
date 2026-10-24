import type { RawCapture } from '@expanses/core';
import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { inject, line, notice, picture } from './capture';

/*
 * What a capture looks like where it is first read: the phone.
 *
 * The draft opens on the Add transaction screen, filled in from what was read. That is where the owner answers and corrects, and a correction is not just a fix to one draft — it is what
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
  await expect(row.locator('[data-capture-type="notification"]')).toHaveCount(1);
  await row.click();

  // The reader knew the figure and the merchant. Whose money it was is the one thing only the owner knows, and the
  // account row asks it as a question of the app rather than of this one payment.
  const form = page.getByRole('form', { name: 'Review TOKO KOPI' });
  await expect(form.getByLabel('Note')).toHaveValue('TOKO KOPI');
  await expect(form.getByText('Remembered for every capture from Pay')).toBeVisible();
  const record = page.getByRole('button', { name: 'Record', exact: true });
  await expect(record).toBeDisabled();
  await form.getByRole('button', { name: 'Which account is this?' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /Everyday bank/ }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await record.click();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Recorded TOKO KOPI' })).toBeVisible();

  // The next capture from the same app is filed there without asking again.
  await inject(page, [notice({ id: 'note-2', capturedAt: '2026-09-30T11:30:00+07:00', body: 'Pembayaran Rp52.000 berhasil. Merchant: SOTO BETAWI' })]);
  await page.getByTestId('draft-row').filter({ hasText: 'SOTO BETAWI' }).click();
  const second = page.getByRole('form', { name: 'Review SOTO BETAWI' });
  await expect(second.getByText('Which account is this?')).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Paid with' })).toContainText('Everyday bank');
});

test('a capture of a merchant recorded before arrives filed under its category', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday bank', balance: '50000000' });
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'Everyday bank', category: 'Restaurants', amount: '32000' });

  await page.goto('/review');
  await inject(page, [
    notice({ id: 'note-kopi', body: 'Pembayaran QRIS Rp45.000 berhasil. Merchant: KOPI KENANGAN' }),
    notice({ id: 'note-roti', capturedAt: '2026-09-30T10:20:00+07:00', body: 'Pembayaran Rp27.000 berhasil. Merchant: ROTI PAGI' }),
  ]);

  // The row reads as the category the shop was last recorded under, as a typed note would fill it on the Add form.
  const kopi = page.getByTestId('draft-row').filter({ hasText: 'KOPI KENANGAN' });
  await expect(kopi).toContainText('Restaurants');
  await expect(kopi).not.toContainText('Choose category');
  // A shop never recorded still asks.
  await expect(page.getByTestId('draft-row').filter({ hasText: 'ROTI PAGI' })).toContainText('Choose category');

  // Opened, it is the form's Category, and it can be changed there like any other.
  await kopi.click();
  const form = page.getByRole('form', { name: 'Review KOPI KENANGAN' });
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Restaurants');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Cafe & dessert', exact: true }).click();
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Cafe & dessert');
});

test('correcting the merchant teaches the source, and the next screenshot is read from it', async ({ page }) => {
  await openAccount(page, { subtype: 'ewallet', name: 'Pay wallet', balance: '1000000' });
  await page.goto('/review');
  await inject(page, [walletScreen('38.000', 'TOKO KOPI MAKMUR')], picture('captures/38.000.png'));

  // No name was read, so the row is named after the screen's own first line.
  const first = page.getByTestId('draft-row').filter({ hasText: 'Pay' });
  await first.click();
  const form = page.getByRole('form', { name: 'Review Pay' });
  await form.getByLabel('Note').fill('TOKO KOPI MAKMUR');
  await form.getByRole('button', { name: 'Which account is this?' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /Pay wallet/ }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();

  // Correcting is also teaching: recording takes the name, and the source is told where it was printed.
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  // The row leaves as soon as Record is pressed; the toast comes once the lesson and the record are both written.
  await expect(page.getByText('Recorded TOKO KOPI MAKMUR')).toBeVisible();

  // The next screen of the same app is read where the correction said the name sits — no second correction needed:
  // the name the owner typed is the name the form now holds.
  await inject(
    page,
    [walletScreen('52.000', 'SOTO BETAWI', { id: 'shot-next', capturedAt: '2026-09-30T09:30:00+07:00' })],
    picture('captures/52.000.png'),
  );
  await page.getByTestId('draft-row').filter({ hasText: 'SOTO BETAWI' }).click();
  await expect(page.getByRole('form', { name: 'Review SOTO BETAWI' }).getByLabel('Note')).toHaveValue('SOTO BETAWI');
});

test('a screenshot opens as the plain picture, with nothing drawn over it', async ({ page }) => {
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

  // The picture stays one tap from the form, on one row that only says what it was.
  await page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI' }).click();
  const box = page.getByRole('button', { name: 'Screenshot · what was read from TOKO KOPI' });
  await expect(box).toHaveText('Screenshot›');
  await expect(box.locator('[data-capture-type="screenshot"]')).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Keep photo' })).toBeVisible();
  await box.click();

  const viewer = page.getByRole('dialog', { name: 'What was read from TOKO KOPI' });
  await expect(viewer.getByRole('heading', { name: 'Screenshot' })).toBeVisible();
  await expect(viewer).toContainText('Screen scanner · Wed 30 Sep');
  await expect(viewer.locator('img')).toBeVisible();
  await expect(viewer.getByText('Pinch to zoom')).toBeVisible();
  // What was read is the form's to say: the picture carries no boxes or labels of its own.
  await expect(viewer.getByText('Amount', { exact: true })).toHaveCount(0);
  await expect(viewer.getByText('Merchant', { exact: true })).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Done' }).click();
  await expect(viewer).toHaveCount(0);
});

test('a text message opens as its words, said once, under who sent it', async ({ page }) => {
  await page.goto('/review');
  // The shortcut handed the whole message over as both the title and the body.
  const said = 'Pembayaran Rp38.000 berhasil. Merchant: TOKO KOPI';
  await inject(page, [notice({ app: 'com.apple.MobileSMS', title: said, body: said })]);

  const row = page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI' });
  await expect(row.locator('[data-capture-type="sms"]')).toHaveCount(1);
  await row.click();
  const box = page.getByRole('button', { name: 'SMS · what was read from TOKO KOPI' });
  await expect(box).toHaveText('SMS›');
  // The amount reads like any other row of the form: nothing beside it asks for it to be checked.
  await expect(page.getByRole('form', { name: 'Review TOKO KOPI' }).getByText('check', { exact: true })).toHaveCount(0);
  await box.click();

  const viewer = page.getByRole('dialog', { name: 'What was read from TOKO KOPI' });
  await expect(viewer.getByRole('heading', { name: 'SMS' })).toBeVisible();
  // The source's name is only the Messages app, which the title already says: the line is just when it arrived.
  await expect(viewer).toContainText('Wed 30 Sep');
  await expect(viewer).not.toContainText('MobileSMS');
  await expect(viewer.getByText(said, { exact: true })).toHaveCount(1);
  await expect(viewer).not.toContainText('The notification said');
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);
});
