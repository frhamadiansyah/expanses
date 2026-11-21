import { expect, type Locator, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { inject, notice } from './capture';

/*
 * A purchase abroad, from the bank's message to the ledger.
 *
 * The bank prints the merchant's figure, in the merchant's currency, and the card is charged in its own. The draft
 * holds what was read; recording it asks what the card was charged, opened on the day's rate, and posts that — with
 * the read figure kept beside it, as a foreign purchase typed on the Add form is.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The message is dated 3 November; the clock is pinned to the day after, so its day's rate is the one asked for.
  await page.clock.setSystemTime(new Date('2026-11-04T12:00:00+07:00'));
});

const ABROAD = notice({
  id: 'sms-abroad',
  capturedAt: '2026-11-03T14:23:00+07:00',
  app: 'BANKCONTOH',
  title: 'BANKCONTOH',
  body: 'Terima kasih utk trx kartukredit XXXX5512 tgl 03-11-2026 14:22:07 di TOKO KOPI CONTOH KRW94.300,00. Jika trx tidak Anda kenal, hub 10000',
});

/** Pointer down, a drag, up — the gesture, not a click. */
async function swipeRight(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from + 160 * (step / 10), y);
  await page.mouse.up();
}

const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });

test('a purchase abroad is read in its own currency, and records as what the card was charged at the day’s rate', async ({ page }) => {
  // One won is eleven rupiah on the day: 94.300 won is 1.037.300 rupiah.
  const asked: string[] = [];
  await page.route('https://api.frankfurter.dev/**', (route) => {
    const url = new URL(route.request().url());
    asked.push(`${url.searchParams.get('base')}>${url.searchParams.get('quotes')}@${url.searchParams.get('date')}`);
    return route.fulfill({ json: [{ date: url.searchParams.get('date'), base: 'KRW', quote: 'IDR', rate: 11 }] });
  });
  await openCard(page, { name: 'Travel card', last4: '5512' });
  await page.goto('/review');
  await inject(page, [ABROAD]);

  // The row says what the message said: the merchant, on the card its digits name, in won — never Rp0.
  const row = page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI CONTOH' });
  await expect(row).toContainText('Travel card');
  await expect(row).toContainText(/₩\s?94[.,]300/);
  await expect(row).not.toContainText('Rp');
  // Nothing was asked of a rate server for a draft merely waiting.
  expect(asked).toEqual([]);

  // A swipe right asks for it to be recorded. The reader was not sure of a figure in won, so the form opens to check it
  // — on the day's rate. (A blank category alone holds nothing back: it would be filed under Uncategorised.)
  await swipeRight(page, row);
  const form = page.getByRole('form', { name: 'Review TOKO KOPI CONTOH' });
  await expect(form).toBeVisible();
  expect(asked).toEqual(['KRW>IDR@2026-11-03']);
  await expect(form.getByLabel('Date')).toHaveValue('2026-11-03');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText('94.300');
  const charged = form.getByRole('button', { name: 'Charged in IDR' });
  await expect(charged).toHaveText('1.037.300');
  // The figure is the form's own estimate, and says so.
  await expect(page.getByText('≈ IDR', { exact: true })).toBeVisible();

  const record = page.getByRole('button', { name: 'Record', exact: true });
  await expect(record).toBeDisabled();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(record).toBeEnabled();
  await record.click();

  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await expect(toast(page)).toContainText('Recorded TOKO KOPI CONTOH');

  // What reached the ledger is the charge, in the card's rupiah, on the day the message printed.
  await page.goto('/transactions?month=%222026-11%22');
  const recorded = page.getByRole('main').getByText('TOKO KOPI CONTOH').first();
  await expect(recorded).toBeVisible();
  await expect(page.getByRole('main')).toContainText('1.037.300');
});

test('a purchase abroad that is tapped opens at once, and its charge fills from the day’s rate', async ({ page }) => {
  // One won is twelve rupiah on the day: 94.300 won is 1.131.600 rupiah.
  await page.route('https://api.frankfurter.dev/**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: [{ date: url.searchParams.get('date'), base: 'KRW', quote: 'IDR', rate: 12 }] });
  });
  await openCard(page, { name: 'Travel card', last4: '5512' });
  await page.goto('/review');
  await inject(page, [ABROAD]);

  await page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI CONTOH' }).click();
  const form = page.getByRole('form', { name: 'Review TOKO KOPI CONTOH' });
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText('94.300');
  await expect(form.getByRole('button', { name: 'Charged in IDR' })).toHaveText('1.131.600');
});

test('the form refuses to record a purchase abroad until the charge is typed, when no rate is to hand', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openCard(page, { name: 'Travel card', last4: '5512' });
  await page.goto('/review');
  await inject(page, [ABROAD]);

  await page.getByTestId('draft-row').filter({ hasText: 'TOKO KOPI CONTOH' }).click();
  const form = page.getByRole('form', { name: 'Review TOKO KOPI CONTOH' });
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();

  // With no rate there is no estimate: the row is empty, and the tick waits for what the card was charged.
  const charged = form.getByRole('button', { name: 'Charged in IDR' });
  await expect(charged).toBeVisible();
  const record = page.getByRole('button', { name: 'Record', exact: true });
  await expect(record).toBeDisabled();

  await charged.click();
  await expect(page.getByTestId('keypad-label')).toHaveText('Charged in IDR');
  const keypad = page.getByTestId('keypad');
  for (const key of '1045000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(charged).toHaveText('1.045.000');
  await expect(record).toBeEnabled();
  await record.click();

  await expect(toast(page)).toContainText('Recorded TOKO KOPI CONTOH');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await page.goto('/transactions?month=%222026-11%22');
  await expect(page.getByRole('main')).toContainText('1.045.000');
  // Nothing is left waiting, and nothing of it was ever counted as rupiah.
  await expect(page.getByTestId('not-recorded-card')).toHaveCount(0);
});
