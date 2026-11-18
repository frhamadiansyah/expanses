import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';

/*
 * Mac Cashflow's paste and blue cells (owner 2026-11-18): a Notion copy read right, a paste's empty categories guessed
 * and its unknown names learnt, pasted rows finished in Cashflow (never Review's), and a range of cells down a column
 * copied, pasted, filled down or given one choice. Every figure, place and card here is invented.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-10-20T12:00:00'));
});

/** Pastes into the typing row's Note cell as ⌘V does, with the HTML a copy carries when it carries some. */
async function pasteInto(page: Page, text: string, html = '') {
  await expect(page.getByTestId('typing-row').getByLabel('Row paid with')).toBeEnabled();
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate(
    (input, { text: plain, html: rich }) => {
      const data = new DataTransfer();
      data.setData('text/plain', plain);
      if (rich) data.setData('text/html', rich);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { text, html },
  );
}

/** ⌘V of text on the page itself (no field focused), as onto a range of blue cells. */
async function pasteOnPage(page: Page, text: string) {
  await page.evaluate((plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** What ⌘C puts on the clipboard from the page: read from the copy event the page answers. */
async function copyOnPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const data = new DataTransfer();
    document.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  });
}

const draftRow = (page: Page, note: string) => page.getByTestId('not-recorded-row').filter({ has: page.locator(`input[value="${note}"]`) });
const cellOf = (row: Locator, column: string) => row.locator(`[data-cell="${column}"]`);

/** Drags from one cell down to another in the same column: the blue range between them. */
async function dragCells(page: Page, from: Locator, to: Locator) {
  await from.hover({ position: { x: 6, y: 6 } });
  await page.mouse.down();
  await to.hover({ position: { x: 8, y: 8 } });
  await page.mouse.up();
}

test('three pasted rows with no category get one, picked once for the range, and are recorded together', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-14\tPasar Lama\t\tBank Contoh\t41.500', '2026-10-15\tKios Sayur\t\tBank Contoh\t17.250', '2026-10-16\tToko Beras\t\tBank Contoh\t96.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  const summary = page.getByTestId('paste-summary');
  await expect(summary).toContainText('Pasted 3 rows · 0 ready to record · 3 need a fix');

  // The rows come in newest first: Toko Beras, Kios Sayur, Pasar Lama. Click the first category cell, ⇧-click the last.
  await draftRow(page, 'Toko Beras').getByLabel('Row category').click();
  await draftRow(page, 'Pasar Lama').getByLabel('Row category').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(3);
  await expect(page.getByTestId('table-note')).toContainText('3 cells');
  await page.screenshot({ path: test.info().outputPath('cashflow-range.png') });

  // Return opens the usual picker once; its choice goes to all three.
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Category for 3 rows' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 3 cells');
  for (const note of ['Pasar Lama', 'Kios Sayur', 'Toko Beras']) await expect(draftRow(page, note).getByLabel('Row category')).toHaveValue('Groceries');
  await expect(summary).toContainText('Pasted 3 rows · 3 ready to record · 0 need a fix');

  await summary.getByRole('button', { name: 'Record 3 ready' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('transaction-row')).toHaveCount(3);
});

test('⌘D fills down from the top cell, Delete clears drafts only, ⌘C copies the cells, ⌘V fills them, and Undo puts a change back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-16\tWarung Satu\tRestaurants\tBank Contoh\t21.000', '2026-10-15\tWarung Dua\t\tBank Contoh\t23.000', '2026-10-14\tWarung Tiga\t\tBank Contoh\t25.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  // The paste's line lands under the typing row a moment after its rows: the table settles before the drag.
  await expect(page.getByTestId('paste-summary')).toContainText('Pasted 3 rows');

  // A drag down the Category column picks the three cells.
  await dragCells(page, cellOf(draftRow(page, 'Warung Satu'), 'category'), cellOf(draftRow(page, 'Warung Tiga'), 'category'));
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+d');
  for (const note of ['Warung Satu', 'Warung Dua', 'Warung Tiga']) await expect(draftRow(page, note).getByLabel('Row category')).toHaveValue('Restaurants');
  await expect(page.getByTestId('cell-change')).toContainText('Changed 2 cells');
  expect(await copyOnPage(page)).toBe('Restaurants\nRestaurants\nRestaurants');

  // Undo puts the two filled cells back as they were.
  await page.getByTestId('cell-change').getByRole('button', { name: 'Undo' }).click();
  await expect(draftRow(page, 'Warung Dua').getByLabel('Row category')).toHaveValue('');
  await expect(draftRow(page, 'Warung Satu').getByLabel('Row category')).toHaveValue('Restaurants');

  // Amounts: several lines fill the picked cells in order; one value fills them all; Delete clears them (drafts).
  await dragCells(page, cellOf(draftRow(page, 'Warung Satu'), 'amount'), cellOf(draftRow(page, 'Warung Tiga'), 'amount'));
  await pasteOnPage(page, '31.000\n32.000\n33.000\n');
  await expect(draftRow(page, 'Warung Satu').getByLabel('Row amount (IDR)')).toHaveValue('31.000');
  await expect(draftRow(page, 'Warung Dua').getByLabel('Row amount (IDR)')).toHaveValue('32.000');
  await expect(draftRow(page, 'Warung Tiga').getByLabel('Row amount (IDR)')).toHaveValue('33.000');
  await pasteOnPage(page, '40.000');
  for (const note of ['Warung Satu', 'Warung Dua', 'Warung Tiga']) await expect(draftRow(page, note).getByLabel('Row amount (IDR)')).toHaveValue('40.000');
  await page.keyboard.press('Delete');
  for (const note of ['Warung Satu', 'Warung Dua', 'Warung Tiga']) await expect(draftRow(page, note).getByLabel('Row amount (IDR)')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-picked="true"]')).toHaveCount(0);
});

test('a range of recorded rows changes them by their own edit, never clears them, and Undo puts them back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-16\tToko A\tGroceries\tBank Contoh\t11.000', '2026-10-15\tToko B\tGroceries\tBank Contoh\t12.000'].join('\n'));
  await page.getByTestId('paste-summary').getByRole('button', { name: 'Record 2 ready' }).click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
  await expect(page.getByTestId('paste-summary')).toHaveCount(0);

  const recorded = (note: string) => page.getByTestId('transaction-row').filter({ hasText: note });
  await dragCells(page, cellOf(recorded('Toko A'), 'category'), cellOf(recorded('Toko B'), 'category'));
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(2);
  // A recorded row's cells are never cleared.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('cell-change')).toContainText('2 skipped: 2 recorded (Delete clears drafts only)');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Category for 2 rows' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 2 cells');
  await expect(recorded('Toko A')).toContainText('Restaurants');
  await expect(recorded('Toko B')).toContainText('Restaurants');
  await page.getByTestId('cell-change').getByRole('button', { name: 'Undo' }).click();
  await expect(recorded('Toko A')).toContainText('Groceries');
  await expect(recorded('Toko B')).toContainText('Groceries');
});

test('pasted rows wait in Cashflow, after a reload too, and are not Review’s: not listed there, nor in its counts', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-16\tToko C\t\tBank Contoh\t13.000', '2026-10-15\tToko D\t\tBank Contoh\t14.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  await expect(page.getByTestId('month-review')).toHaveText('0');
  const nav = page.locator('aside').getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: /^Review/ })).toHaveText('Review');

  await page.goto('/review');
  await expect(page.getByTestId('review-to-review-count')).toHaveText('0');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Discarded' }).click();
  await expect(page.getByTestId('resolved-row')).toHaveCount(0);

  await page.goto('/transactions');
  await page.reload();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
});

test('a Notion copy reads right: its header names, YYYY/MM/DD dates, a card by its last four digits, a relation’s link left out', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await openCard(page, { name: 'Kartu Contoh', owed: '0', last4: '7316' });
  await page.goto('/transactions');
  const notion = [
    'Date\tName\tSub Categories\tAccount\tAmount',
    '2026/10/03\tToko Sumber Rejeki\tGroceries (https://www.notion.so/Groceries-0a1b2c3d4e5f60718293a4b5c6d7e8f9)\t7316\t123,400',
    '2026/10/04\t[Kedai Kopi Senja](https://www.notion.so/9f8e7d6c)\tCafe\t····7316\t36,000',
    '2026/10/05\tParkir Mal\tParking\t0000\t5,000',
  ].join('\n');
  await pasteInto(page, notion);
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  const toko = draftRow(page, 'Toko Sumber Rejeki');
  await expect(toko.getByLabel('Row date')).toHaveValue('3 Oct');
  await expect(toko.getByLabel('Row category')).toHaveValue('Groceries');
  await expect(toko.getByLabel('Row paid with')).toHaveValue('Kartu Contoh');
  await expect(toko.getByLabel('Row amount (IDR)')).toHaveValue('123.400');
  await expect(draftRow(page, 'Kedai Kopi Senja').getByLabel('Row paid with')).toHaveValue('Kartu Contoh');
  // Digits no card or account shows: the cell stays to be filled, never guessed.
  await expect(draftRow(page, 'Parkir Mal').getByLabel('Row paid with')).toHaveValue('');
  await expect(page.getByTestId('paste-summary')).toContainText('Pasted 3 rows · 2 ready to record · 1 needs a fix');
});

test('Notion’s whole rows (page links, no cells) are not pasted as notes: a line says how to copy cells', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  const html = '<meta charset="utf-8"><p><a href="https://app.notion.com/p/Toko-0a1b2c">Toko Contoh</a></p><p><a href="https://app.notion.com/p/Kopi-3d4e5f">Kopi Contoh</a></p>';
  await pasteInto(page, '# Toko Contoh\n\nToko Contoh\n\nKopi Contoh', html);
  await expect(page.getByTestId('paste-notice')).toHaveText('Copied Notion rows, not cells — select the cells (click one, Shift-click the last) and copy again');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('typing-row').getByLabel('Row description')).toHaveValue('');
});

test('a paste’s empty category is guessed from the place’s last purchase, and a name no category has is learnt once recorded', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-10\tWarung Bu Sri\tRestaurants\tBank Contoh\t22.000', '2026-10-11\tKantin Kantor\tMakan\tBank Contoh\t19.000'].join('\n'));
  // "Makan" is no category's name: orange, never guessed.
  await expect(draftRow(page, 'Kantin Kantor').getByLabel('Row category')).toHaveValue('');
  await page.getByTestId('paste-summary').getByRole('button', { name: 'Record 1 ready' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  // Picked for that row and recorded: "Makan" is remembered as Restaurants on this device.
  const kantin = draftRow(page, 'Kantin Kantor');
  await kantin.getByLabel('Row category').fill('Restaurants');
  await kantin.getByLabel('Row category').press('Enter');
  await kantin.getByRole('button', { name: 'Record Kantin Kantor' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);

  await pasteInto(page, ['2026-10-12\tWarung Bu Sri\t\tBank Contoh\t24.000', '2026-10-13\tKantin Lantai 3\tmakan\tBank Contoh\t18.000', '2026-10-14\tToko Baru Sekali\t\tBank Contoh\t9.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  const sri = draftRow(page, 'Warung Bu Sri').getByLabel('Row category');
  await expect(sri).toHaveValue('Restaurants');
  await expect(sri).toHaveAttribute('data-guessed', 'true');
  await expect(sri).toHaveAttribute('title', 'Category guessed from the last time this was bought here');
  const lantai = draftRow(page, 'Kantin Lantai 3').getByLabel('Row category');
  await expect(lantai).toHaveValue('Restaurants');
  await expect(lantai).toHaveAttribute('title', 'Category guessed from an earlier paste of “makan”');
  // No history for that place and nothing named: orange.
  await expect(draftRow(page, 'Toko Baru Sekali').getByLabel('Row category')).toHaveValue('');
  await expect(draftRow(page, 'Toko Baru Sekali').getByLabel('Row category')).not.toHaveAttribute('data-guessed', 'true');
});
