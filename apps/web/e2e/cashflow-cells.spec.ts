import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';

/*
 * Mac Cashflow's paste and blue cells (owner 2026-11-18): a Notion copy read right, a paste's empty categories guessed
 * and its unknown names learnt, pasted rows waiting in Cashflow and in Review alike, and a range of cells down a column
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
/** A waiting row's figure, read as the recorded rows print it ("Rp 31.000") while its cell is not typed in. */
const money = (figure: string) => new RegExp(`^Rp\\s?${figure.replace(/\./g, '\\.')}$`);
/** A waiting row's own Record: black once complete, disabled (grey) while a cell is blank. */
const recordOf = (page: Page, note: string) => draftRow(page, note).getByRole('button', { name: `Record ${note}` });
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
  // A blank category does not hold Record back (the row would be recorded under Uncategorised).
  for (const note of ['Pasar Lama', 'Kios Sayur', 'Toko Beras']) await expect(recordOf(page, note)).toBeEnabled();

  // The rows wait in the order pasted: Pasar Lama, Kios Sayur, Toko Beras. A drag down the Category cells picks the three
  // (⇧-click picks rows; once two cells are blue, ⇧-click in their column stretches them).
  await dragCells(page, cellOf(draftRow(page, 'Pasar Lama'), 'category'), cellOf(draftRow(page, 'Kios Sayur'), 'category'));
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(2);
  await draftRow(page, 'Toko Beras').getByLabel('Row category').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(3);
  await expect(page.getByTestId('cashflow-selection')).toHaveCount(0);
  await expect(page.getByTestId('table-note')).toContainText('3 cells');
  await page.screenshot({ path: test.info().outputPath('cashflow-range.png') });

  // Return opens the usual picker once; its choice goes to all three.
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Category for 3 rows' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 3 cells');
  for (const note of ['Pasar Lama', 'Kios Sayur', 'Toko Beras']) await expect(draftRow(page, note).getByLabel('Row category')).toHaveValue('Groceries');
  for (const note of ['Pasar Lama', 'Kios Sayur', 'Toko Beras']) await expect(recordOf(page, note)).toBeEnabled();

  // ⌘-click picks the three; the peek's Record 3 records them together, into the month on show.
  for (const note of ['Pasar Lama', 'Kios Sayur', 'Toko Beras']) await draftRow(page, note).getByLabel('Row date').click({ modifiers: ['ControlOrMeta'] });
  const picked = page.getByTestId('cashflow-selection');
  await expect(picked.getByTestId('peek-title')).toHaveText('3 selected');
  await picked.getByTestId('record-many').click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('transaction-row')).toHaveCount(3);
  await expect(page.getByTestId('recorded-toast')).toContainText('Recorded 3 in October 2026');
});

test('⌘D fills down from the top cell, Delete clears drafts only, ⌘C copies the cells, ⌘V fills them, and Undo puts a change back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-16\tWarung Satu\tRestaurants\tBank Contoh\t21.000', '2026-10-15\tWarung Dua\t\tBank Contoh\t23.000', '2026-10-14\tWarung Tiga\t\tBank Contoh\t25.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  await expect(draftRow(page, 'Warung Satu').getByLabel('Row category')).toHaveValue('Restaurants');

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
  await expect(draftRow(page, 'Warung Satu').getByLabel('Row amount (IDR)')).toHaveValue(money('31.000'));
  await expect(draftRow(page, 'Warung Dua').getByLabel('Row amount (IDR)')).toHaveValue(money('32.000'));
  await expect(draftRow(page, 'Warung Tiga').getByLabel('Row amount (IDR)')).toHaveValue(money('33.000'));
  await pasteOnPage(page, '40.000');
  for (const note of ['Warung Satu', 'Warung Dua', 'Warung Tiga']) await expect(draftRow(page, note).getByLabel('Row amount (IDR)')).toHaveValue(money('40.000'));
  await page.keyboard.press('Delete');
  for (const note of ['Warung Satu', 'Warung Dua', 'Warung Tiga']) await expect(draftRow(page, note).getByLabel('Row amount (IDR)')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-picked="true"]')).toHaveCount(0);
});

test('a range of recorded rows changes them by their own edit, never clears them, and Undo puts them back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-16\tToko A\tGroceries\tBank Contoh\t11.000', '2026-10-15\tToko B\tGroceries\tBank Contoh\t12.000'].join('\n'));
  await recordOf(page, 'Toko A').click();
  await recordOf(page, 'Toko B').click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);

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

test('pasted rows wait in Cashflow and in Review alike: counted by both, recorded in Review gone from Cashflow, discarded in Cashflow gone from Review', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-16\tToko C\tGroceries\tBank Contoh\t13.000', '2026-10-15\tToko D\tGroceries\tBank Contoh\t14.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  // This month's To review counts them; the month's figures still leave them out.
  await expect(page.getByTestId('month-review')).toHaveText('2');
  const nav = page.locator('aside').getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: /^Review/ })).toHaveText(/^Review\s*2$/);
  await page.reload();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);

  await nav.getByRole('link', { name: /^Review/ }).click();
  await expect(page.getByTestId('review-to-review-count')).toHaveText('2');
  await expect(page.getByTestId('review-ready-count')).toHaveText('2');
  const toko = (note: string) => page.getByTestId('draft-row').filter({ hasText: note });
  await expect(page.getByTestId('draft-row')).toHaveCount(2);
  // Its From says the door it came in by; the peek has no captured words to show.
  await expect(toko('Toko C').getByTestId('review-from')).toHaveText('Cashflow');
  await toko('Toko C').click();
  await expect(page.getByTestId('peek-when')).toContainText('typed or pasted in Cashflow');
  await expect(page.getByTestId('peek-captured')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await toko('Toko C').getByRole('button', { name: 'Record Toko C' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await expect(page.getByTestId('review-to-review-count')).toHaveText('1');
  await expect(nav.getByRole('link', { name: /^Review/ })).toHaveText(/^Review\s*1$/);

  // Recorded in Review, it no longer waits in Cashflow: it is a row of its month.
  await nav.getByRole('link', { name: /^Cashflow/ }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(draftRow(page, 'Toko D')).toHaveCount(1);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Toko C' })).toHaveCount(1);
  await expect(page.getByTestId('month-review')).toHaveText('1');
  // ✕ (twice) in Cashflow discards it from Review too.
  await draftRow(page, 'Toko D').getByRole('button', { name: 'Discard' }).click();
  await draftRow(page, 'Toko D').getByRole('button', { name: 'Click again to discard' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(page.getByTestId('month-review')).toHaveText('0');
  await expect(nav.getByRole('link', { name: /^Review/ })).toHaveText('Review');

  await nav.getByRole('link', { name: /^Review/ }).click();
  await expect(page.getByTestId('review-to-review-count')).toHaveText('0');
  await expect(page.getByTestId('draft-row')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Recorded' }).click();
  await expect(page.getByTestId('resolved-row').filter({ hasText: 'Toko C' })).toHaveCount(1);
  await page.getByRole('radio', { name: 'Discarded' }).click();
  await expect(page.getByTestId('resolved-row').filter({ hasText: 'Toko D' })).toHaveCount(1);
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
  // A waiting row says its date as a recorded row does: no year in this one.
  await expect(toko.getByLabel('Row date')).toHaveValue('3 Oct');
  await expect(toko.getByLabel('Row category')).toHaveValue('Groceries');
  await expect(toko.getByLabel('Row paid with')).toHaveValue('Kartu Contoh');
  await expect(toko.getByLabel('Row amount (IDR)')).toHaveValue(money('123.400'));
  await expect(draftRow(page, 'Kedai Kopi Senja').getByLabel('Row paid with')).toHaveValue('Kartu Contoh');
  // Digits no card or account shows: the cell stays to be filled, never guessed.
  await expect(draftRow(page, 'Parkir Mal').getByLabel('Row paid with')).toHaveValue('');
  await expect(recordOf(page, 'Toko Sumber Rejeki')).toBeEnabled();
  await expect(recordOf(page, 'Kedai Kopi Senja')).toBeEnabled();
  await expect(recordOf(page, 'Parkir Mal')).toBeDisabled();
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
  // "Makan" is no category's name: left blank, never guessed.
  await expect(draftRow(page, 'Kantin Kantor').getByLabel('Row category')).toHaveValue('');
  await recordOf(page, 'Warung Bu Sri').click();
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
  // No history for that place and nothing named: blank.
  await expect(draftRow(page, 'Toko Baru Sekali').getByLabel('Row category')).toHaveValue('');
  await expect(draftRow(page, 'Toko Baru Sekali').getByLabel('Row category')).not.toHaveAttribute('data-guessed', 'true');
});

test('a Notion relation’s page links are picked once and remembered: the other rows naming them fill in, and so does the next paste', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  // Invented page ids: a category relation shared by two rows, another for the third, and an account relation.
  const food = 'https://app.notion.com/0f1e2d3c4b5a69788796a5b4c3d2e1f0';
  const other = 'https://www.notion.so/Other-aaaabbbbccccddddeeeeffff00001111?pvs=21';
  const bank = 'https://app.notion.com/11112222333344445555666677778888';
  const rows = [`2026/10/14\tPasar Contoh\t${food}\t${bank}\t41,500`, `2026/10/15\tKios Contoh\t${food}\t${bank}\t17,250`, `2026/10/16\tToko Contoh\t${other}\t\t9,000`].join('\n');
  await pasteInto(page, rows);
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  // A light grey count in the box header, no colour.
  const links = page.getByTestId('links-to-pick');
  await expect(links).toHaveText('3 Notion links to pick');
  // No address is put into a cell.
  for (const note of ['Pasar Contoh', 'Kios Contoh', 'Toko Contoh']) {
    await expect(draftRow(page, note).getByLabel('Row category')).toHaveValue('');
    await expect(draftRow(page, note).getByLabel('Row paid with')).toHaveValue('');
  }
  await expect(page.locator('input[value*="notion"]')).toHaveCount(0);

  // A category picked on one row, kept as not recorded (the row left): the other row with the same link fills in.
  const pasar = draftRow(page, 'Pasar Contoh');
  await pasar.getByLabel('Row category').fill('Groceries');
  await pasar.getByLabel('Row category').press('Enter');
  await page.getByRole('heading', { name: 'Cashflow' }).click();
  const kios = draftRow(page, 'Kios Contoh');
  await expect(kios.getByLabel('Row category')).toHaveValue('Groceries');
  await expect(kios.getByLabel('Row category')).toHaveAttribute('data-guessed', 'true');
  await expect(kios.getByLabel('Row category')).toHaveAttribute('title', 'Category remembered for this Notion link');
  await expect(draftRow(page, 'Toko Contoh').getByLabel('Row category')).toHaveValue('');
  await expect(links).toHaveText('2 Notion links to pick');

  // Paid with, the same way.
  await pasar.getByLabel('Row paid with').fill('Bank Contoh');
  await pasar.getByLabel('Row paid with').press('Enter');
  await page.getByRole('heading', { name: 'Cashflow' }).click();
  await expect(kios.getByLabel('Row paid with')).toHaveValue('Bank Contoh');
  await expect(kios.getByLabel('Row paid with')).toHaveAttribute('title', 'Paid with remembered for this Notion link');
  await expect(links).toHaveText('1 Notion link to pick');

  // The rows discarded (✕, twice), then pasted again: the known links fill in on their own.
  for (const note of ['Pasar Contoh', 'Kios Contoh', 'Toko Contoh']) {
    await draftRow(page, note).getByRole('button', { name: 'Discard' }).click();
    await draftRow(page, note).getByRole('button', { name: 'Click again to discard' }).click();
  }
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(links).toHaveCount(0);
  await pasteInto(page, rows);
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  for (const note of ['Pasar Contoh', 'Kios Contoh']) {
    await expect(draftRow(page, note).getByLabel('Row category')).toHaveValue('Groceries');
    await expect(draftRow(page, note).getByLabel('Row paid with')).toHaveValue('Bank Contoh');
  }
  await expect(links).toHaveText('1 Notion link to pick');
  await expect(recordOf(page, 'Pasar Contoh')).toBeEnabled();
  await expect(recordOf(page, 'Kios Contoh')).toBeEnabled();
  await expect(recordOf(page, 'Toko Contoh')).toBeDisabled();
});

test('a row recorded with its place’s history guess teaches its Notion link, and the other waiting row with that link fills in', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  // History for the first place only: one purchase there recorded as Restaurants.
  await pasteInto(page, '2026-10-08\tWarung Pak Darmo\tRestaurants\tBank Contoh\t27.000');
  await recordOf(page, 'Warung Pak Darmo').click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);

  // Two places sharing one invented category link, not known on this device yet.
  const meals = 'https://app.notion.com/5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
  await pasteInto(page, [`2026/10/15\tWarung Pak Darmo\t${meals}\tBank Contoh\t31,500`, `2026/10/16\tGerobak Bakso Contoh\t${meals}\tBank Contoh\t16,000`].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  const darmo = draftRow(page, 'Warung Pak Darmo').getByLabel('Row category');
  await expect(darmo).toHaveValue('Restaurants');
  await expect(darmo).toHaveAttribute('title', 'Category guessed from the last time this was bought here');
  const bakso = draftRow(page, 'Gerobak Bakso Contoh');
  await expect(bakso.getByLabel('Row category')).toHaveValue('');
  await expect(page.getByTestId('links-to-pick')).toHaveText('1 Notion link to pick');

  // Recorded as it shows: the guess is the owner's yes, so the link is learnt and the other row fills in at once.
  await recordOf(page, 'Warung Pak Darmo').click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(bakso.getByLabel('Row category')).toHaveValue('Restaurants');
  await expect(bakso.getByLabel('Row category')).toHaveAttribute('title', 'Category remembered for this Notion link');
  await expect(page.getByTestId('links-to-pick')).toHaveCount(0);
  await expect(recordOf(page, 'Gerobak Bakso Contoh')).toBeEnabled();
});

test('a pasted category is matched with accents left out and “&” as “and”, and nothing looser', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-10-10\tWarung Contoh\tRESTAURANTS\tBank Contoh\t22.000', '2026-10-11\tKedai Contoh\tGroçeries\tBank Contoh\t19.000', '2026-10-12\tToko Contoh\tCafé and Dessert\tBank Contoh\t9.000', '2026-10-13\tKue Contoh\tDesert\tBank Contoh\t7.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(4);
  await expect(draftRow(page, 'Toko Contoh').getByLabel('Row category')).toHaveValue('Cafe & dessert');
  await expect(draftRow(page, 'Warung Contoh').getByLabel('Row category')).toHaveValue('Restaurants');
  await expect(draftRow(page, 'Kedai Contoh').getByLabel('Row category')).toHaveValue('Groceries');
  // A misspelling stays blank.
  await expect(draftRow(page, 'Kue Contoh').getByLabel('Row category')).toHaveValue('');
});

test('a pasted card or account not in cicis yet stays on its rows, is added from the cell in the side peek, and fills every row naming it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-09-14\tToko Buah Contoh\tGroceries\t5512\t412.300', '2026-09-13\tKedai Teh Contoh\tGroceries\t····5512\t58.000', '2026-09-12\tParkir Contoh\tParking\tJago\t15.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  const buah = draftRow(page, 'Toko Buah Contoh');
  const teh = draftRow(page, 'Kedai Teh Contoh');
  const parkir = draftRow(page, 'Parkir Contoh');
  // The pasted text stays in the cell with a dashed line, and Record stays grey until it names a way to pay.
  await expect(buah.getByTestId('paid-pending')).toHaveText('•• 5512');
  await expect(teh.getByTestId('paid-pending')).toHaveText('•• 5512');
  await expect(parkir.getByTestId('paid-pending')).toHaveText('Jago');
  await expect(buah.getByLabel('Row paid with')).toHaveAttribute('title', 'Not in cicis yet');
  for (const note of ['Toko Buah Contoh', 'Kedai Teh Contoh', 'Parkir Contoh']) await expect(recordOf(page, note)).toBeDisabled();
  // Kept over a reload.
  await page.reload();
  await expect(buah.getByTestId('paid-pending')).toHaveText('•• 5512');
  // Review lists the same rows, its Paid with cell showing the same text.
  const nav = page.locator('aside').getByRole('navigation', { name: 'Sections' });
  await nav.getByRole('link', { name: /^Review/ }).click();
  await expect(page.getByTestId('draft-row').filter({ hasText: 'Toko Buah Contoh' }).getByTestId('paid-pending')).toHaveText('•• 5512');
  await expect(page.getByTestId('draft-row').filter({ hasText: 'Parkir Contoh' }).getByTestId('paid-pending')).toHaveText('Jago');
  await nav.getByRole('link', { name: /^Cashflow/ }).click();

  // The cell's picker: what to add first, with the rows waiting for it, then the ways to pay already there.
  await buah.getByLabel('Row paid with').click();
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option')).toHaveText([/^＋ Add a credit card ending 5512\s*2 rows$/, '＋ Add a debit card or account ending 5512', /^Bank Contoh/]);
  await list.getByRole('option', { name: /Add a credit card ending 5512/ }).click();
  const peek = page.getByTestId('new-paid-peek');
  await expect(peek.getByRole('heading')).toContainText('New credit card');
  await expect(peek.getByTestId('new-paid-line')).toHaveText('From the pasted rows · 2 rows wait for it');
  await expect(peek.getByLabel('Last 4 digits')).toHaveValue('5512');
  await expect(peek.getByRole('button', { name: 'Add card' })).toBeDisabled();
  await peek.getByLabel('Name').fill('Kartu Baru');
  await peek.getByRole('button', { name: 'Add card' }).click();
  await expect(peek).toHaveCount(0);
  // Both rows naming 5512 fill in and can be recorded; Jago still waits.
  await expect(buah.getByLabel('Row paid with')).toHaveValue('Kartu Baru');
  await expect(teh.getByLabel('Row paid with')).toHaveValue('Kartu Baru');
  await expect(buah.getByTestId('paid-pending')).toHaveCount(0);
  await expect(recordOf(page, 'Toko Buah Contoh')).toBeEnabled();
  await expect(recordOf(page, 'Kedai Teh Contoh')).toBeEnabled();
  await expect(recordOf(page, 'Parkir Contoh')).toBeDisabled();

  // A name works the same way: an account named Jago.
  await parkir.getByLabel('Row paid with').click();
  await expect(page.getByRole('listbox').getByRole('option').first()).toHaveText(/^＋ Add an account named Jago\s*1 row$/);
  await page.getByRole('option', { name: /Add an account named Jago/ }).click();
  await expect(peek.getByRole('heading')).toContainText('New account');
  await expect(peek.getByLabel('Name')).toHaveValue('Jago');
  await peek.getByRole('button', { name: 'Add account' }).click();
  await expect(peek).toHaveCount(0);
  await expect(parkir.getByLabel('Row paid with')).toHaveValue('Jago');
  await expect(recordOf(page, 'Parkir Contoh')).toBeEnabled();

  // A later paste naming 5512 (any mask) or Jago matches what was added.
  await pasteInto(page, ['2026-09-20\tToko Lagi Contoh\tGroceries\txxxx 5512\t10.000', '2026-09-21\tParkir Lagi Contoh\tParking\tjago\t5.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(5);
  await expect(draftRow(page, 'Toko Lagi Contoh').getByLabel('Row paid with')).toHaveValue('Kartu Baru');
  await expect(draftRow(page, 'Parkir Lagi Contoh').getByLabel('Row paid with')).toHaveValue('Jago');
  await expect(recordOf(page, 'Toko Lagi Contoh')).toBeEnabled();
});
