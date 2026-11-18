import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * Mac Cashflow option E (owner 2026-11-18): the table reads oldest at the top, and the typing row is its last row. Rows
 * pasted (or kept unfinished) wait just above it, in the order pasted, whatever month is shown, each with its own Record
 * and ✕ — no amber, no orange boxes, no blue at rest. ⌘-click picks several for Record N. A row recorded goes to its own
 * month, and a toast says which, with Show › and Undo. Every figure, place and card here is invented.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-11-18T12:00:00'));
});

async function pasteInto(page: Page, text: string) {
  await expect(page.getByTestId('typing-row').getByLabel('Row paid with')).toBeEnabled();
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate((input, plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const draftRow = (page: Page, note: string) => page.getByTestId('not-recorded-row').filter({ has: page.locator(`input[value="${note}"]`) });
const recordOf = (page: Page, note: string) => draftRow(page, note).getByRole('button', { name: `Record ${note}` });
const cellOf = (row: Locator, column: string) => row.locator(`[data-cell="${column}"]`);

async function dragCells(page: Page, from: Locator, to: Locator) {
  await from.hover({ position: { x: 6, y: 6 } });
  await page.mouse.down();
  await to.hover({ position: { x: 8, y: 8 } });
  await page.mouse.up();
}

/** The notes of the table's rows top to bottom — recorded, waiting, then the typing row's — as the table reads. */
async function tableOrder(page: Page): Promise<string[]> {
  return page.getByRole('region', { name: 'Transactions' }).evaluate((box) =>
    [...box.querySelectorAll<HTMLElement>('[data-testid="transaction-row"], [data-testid="not-recorded-row"], [data-testid="typing-row"]')].map((row) => {
      if (row.dataset.testid === 'typing-row') return '(typing row)';
      const input = row.querySelector<HTMLInputElement>('input[aria-label="Row description"]');
      return input ? input.value : (row.querySelector('[data-cell="description"]')?.textContent ?? '');
    }),
  );
}

/** Nothing amber or orange anywhere in the table: no missing-cell class, no warm background or ring. */
async function expectNoAmber(page: Page) {
  const warm = await page.getByRole('region', { name: 'Transactions' }).evaluate((box) => {
    const found: string[] = [];
    for (const el of box.querySelectorAll<HTMLElement>('*')) {
      if (/amber|orange|ph-warn/.test(el.getAttribute('class') ?? '')) found.push(`class ${el.className}`);
      const style = getComputedStyle(el);
      for (const colour of [style.backgroundColor, style.color, style.boxShadow, style.outlineColor]) {
        const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(colour);
        // Amber and orange: red high, green middling, blue low.
        if (rgb && Number(rgb[1]) > 200 && Number(rgb[2]) > 100 && Number(rgb[2]) < 215 && Number(rgb[3]) < 120) found.push(`${el.tagName} ${colour}`);
      }
    }
    return found;
  });
  expect(warm).toEqual([]);
}

test('rows pasted from two months back wait just above the typing row, are filled and recorded, and go to their own month', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Pagi', paidWith: 'Bank Contoh', category: 'Restaurants', amount: '27000', date: '2026-11-02' });
  await addTransaction(page, { description: 'Toko Siang', paidWith: 'Bank Contoh', category: 'Groceries', amount: '54000', date: '2026-11-10' });
  await page.goto('/transactions');
  await expect(page.getByTestId('chart-month')).toHaveText('November 2026');
  await expect(page.getByTestId('table-note')).toHaveText('oldest at the top · new rows at the bottom');

  // September's rows pasted while November is shown; two of them with no category.
  await pasteInto(
    page,
    ['2026-09-14\tKedai Contoh\tGroceries\tBank Contoh\t60.700', '2026-09-13\tBioskop Contoh\tMovies\tBank Contoh\t16.000', '2026-09-13\tTeh Contoh\t\tBank Contoh\t6.200', '2026-09-12\tKopi Contoh\t\tBank Contoh\t8.900'].join('\n'),
  );
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(4);
  // Oldest at the top; the pasted rows in the order pasted just above the typing row, which is the last row.
  expect(await tableOrder(page)).toEqual(['Warung Pagi', 'Toko Siang', 'Kedai Contoh', 'Bioskop Contoh', 'Teh Contoh', 'Kopi Contoh', '(typing row)']);
  await expect(draftRow(page, 'Teh Contoh').getByLabel('Row date')).toHaveValue('13 Sep 2026');
  // Not repeated in their own month's list.
  await page.getByRole('button', { name: 'Earlier period' }).click();
  await page.getByRole('button', { name: 'Earlier period' }).click();
  await expect(page.getByTestId('chart-month')).toHaveText('September 2026');
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Later period' }).click();
  await page.getByRole('button', { name: 'Later period' }).click();
  await expect(page.getByTestId('chart-month')).toHaveText('November 2026');

  // Black Record when complete, grey while a cell is blank; the same text colours as a recorded row.
  await expect(recordOf(page, 'Kedai Contoh')).toBeEnabled();
  await expect(recordOf(page, 'Teh Contoh')).toBeDisabled();
  const colours = await page.evaluate(() => {
    const read = (el: Element | null | undefined) => (el ? getComputedStyle(el).color : null);
    const recorded = document.querySelector('[data-testid="transaction-row"]');
    const waiting = [...document.querySelectorAll('[data-testid="not-recorded-row"]')].find((row) => row.querySelector('input[value="Kedai Contoh"]'));
    const ground = (button: Element | null | undefined) => (button ? getComputedStyle(button).backgroundColor : null);
    return {
      date: [read(recorded?.querySelector('[data-cell="date"]')), read(waiting?.querySelector('[data-cell="date"] input'))],
      note: [read(recorded?.querySelector('[data-cell="description"]')), read(waiting?.querySelector('[data-cell="description"] input'))],
      paid: [read(recorded?.querySelector('[data-cell="paid"]')), read(waiting?.querySelector('[data-cell="paid"] input'))],
      amount: [read(recorded?.querySelector('[data-cell="amount"]')), read(waiting?.querySelector('[data-cell="amount"] input'))],
      complete: ground(waiting?.querySelector('button[aria-label="Record Kedai Contoh"]')),
      blank: ground([...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Record Teh Contoh')),
    };
  });
  for (const pair of [colours.date, colours.note, colours.paid, colours.amount]) expect(pair[1]).toBe(pair[0]);
  expect(colours.complete).toBe('rgb(28, 28, 30)');
  expect(colours.blank).not.toBe(colours.complete);
  await expect(draftRow(page, 'Kedai Contoh').getByLabel('Row amount (IDR)')).toHaveValue(/^Rp\s?60\.700$/);
  // No amber row or orange box, and no blue cell at rest.
  await expectNoAmber(page);
  await expect(page.locator('[data-picked="true"]')).toHaveCount(0);
  await expect(page.getByTestId('paste-summary')).toHaveCount(0);

  // The two blank Category cells: dragged blue, one choice for both; Esc lets the blue go.
  await dragCells(page, cellOf(draftRow(page, 'Teh Contoh'), 'category'), cellOf(draftRow(page, 'Kopi Contoh'), 'category'));
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Category for 2 rows' }).getByRole('button', { name: 'Cafe & dessert', exact: true }).click();
  await expect(draftRow(page, 'Teh Contoh').getByLabel('Row category')).toHaveValue('Cafe & dessert');
  await expect(draftRow(page, 'Kopi Contoh').getByLabel('Row category')).toHaveValue('Cafe & dessert');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-picked="true"]')).toHaveCount(0);

  // One by its own Record: it leaves the waiting rows; the toast says where, and Undo brings it back.
  await recordOf(page, 'Kedai Contoh').click();
  const toast = page.getByTestId('recorded-toast');
  await expect(toast).toContainText('Recorded in September 2026');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(4);
  await recordOf(page, 'Kedai Contoh').click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);

  // ⌘-click picks the other three; Record 3 records them together, one toast for them all.
  for (const note of ['Bioskop Contoh', 'Teh Contoh', 'Kopi Contoh']) await draftRow(page, note).getByLabel('Row date').click({ modifiers: ['ControlOrMeta'] });
  const picked = page.getByTestId('cashflow-selection');
  await expect(picked.getByTestId('peek-title')).toHaveText('3 selected');
  await expect(picked.getByTestId('record-many')).toHaveText('Record 3');
  await expect(picked.getByTestId('record-skipped')).toHaveCount(0);
  await picked.getByTestId('record-many').click();
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(0);
  await expect(toast).toContainText('Recorded in September 2026');
  // The typing row is still the last row.
  expect(await tableOrder(page)).toEqual(['Warung Pagi', 'Toko Siang', '(typing row)']);

  // Show › opens September, where the four now live, oldest first.
  await toast.getByRole('button', { name: 'Show ›' }).click();
  await expect(page.getByTestId('chart-month')).toHaveText('September 2026');
  await expect(page.getByTestId('transaction-row')).toHaveCount(4);
  await expect(page.getByTestId('transaction-row').first()).toContainText('Kopi Contoh');
  await expect(page.getByTestId('transaction-row').last()).toContainText('Kedai Contoh');
  await expectNoAmber(page);
});

test('Record N records the complete ones of those picked and says how many it skips; rows of two months are said together', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ['2026-08-30\tPasar Contoh\tGroceries\tBank Contoh\t41.500', '2026-09-02\tKios Contoh\tGroceries\tBank Contoh\t17.250', '2026-09-03\tToko Contoh\t\tBank Contoh\t9.000'].join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  for (const note of ['Pasar Contoh', 'Kios Contoh', 'Toko Contoh']) await draftRow(page, note).getByLabel('Row date').click({ modifiers: ['ControlOrMeta'] });
  const picked = page.getByTestId('cashflow-selection');
  await expect(picked.getByTestId('peek-title')).toHaveText('3 selected');
  await expect(picked.getByTestId('record-many')).toHaveText('Record 2');
  await expect(picked.getByTestId('record-skipped')).toHaveText('1 with a blank cell is skipped');
  // Only waiting rows picked: none of the recorded rows' actions.
  await expect(picked.getByRole('button', { name: 'Add to event' })).toHaveCount(0);
  await picked.getByTestId('record-many').click();
  await expect(page.getByTestId('recorded-toast')).toContainText('Recorded in August and September 2026');
  // The one skipped stays waiting, and picked.
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(draftRow(page, 'Toko Contoh')).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(draftRow(page, 'Toko Contoh')).not.toHaveAttribute('data-selected', 'true');
});

test('a row typed into the last row is recorded into the list above it, and the Date header still turns the order round', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  const typing = page.getByTestId('typing-row');
  for (const [note, amount] of [
    ['Roti Contoh', '15000'],
    ['Sate Contoh', '42000'],
  ] as const) {
    await typing.getByLabel('Row description').fill(note);
    await typing.getByLabel('Row category').fill('Restaurants');
    await typing.getByLabel('Row category').press('Enter');
    // What paid carries down to the next row: picked once.
    if (note === 'Roti Contoh') {
      await typing.getByLabel('Row paid with').fill('Bank Contoh');
      await typing.getByLabel('Row paid with').press('Enter');
    }
    await typing.getByLabel('Row amount (IDR)').fill(amount);
    await typing.getByLabel('Row amount (IDR)').press('Enter');
    await expect(page.getByTestId('transaction-row').filter({ hasText: note })).toHaveCount(1);
    // The typing row clears once the row is saved, keeping the day and what paid.
    await expect(typing.getByLabel('Row description')).toHaveValue('');
  }
  await expect(typing.getByLabel('Row date')).toHaveValue('18 Nov');
  expect(await tableOrder(page)).toEqual(['Roti Contoh', 'Sate Contoh', '(typing row)']);
  await page.getByRole('button', { name: /^Date/ }).click();
  expect(await tableOrder(page)).toEqual(['Sate Contoh', 'Roti Contoh', '(typing row)']);
  await expect(page.getByTestId('table-note')).toHaveText('newest at the top · new rows at the bottom');
});
