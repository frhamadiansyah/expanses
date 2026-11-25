import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { cellOf, dragCells, notes, pasteRows, recordAll, recordedRow } from './table-extras';

/*
 * The Mac tables' Sheets and Notion behaviours (owner 2026-11-25, docs/mockups/2026-11-24-mac-table-extras.html), first
 * drop: the sum of picked Amount cells, the Total under the rows shown, Sort (and Amount's Over / Under) from a column's
 * name, and the column names staying on top while the month scrolls. Every figure and place is invented.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-10-20T12:00:00'));
});

const ROWS = ['2026-10-03\tGrab Ride\t\tBank Contoh\t38.000', '2026-10-05\tGrab Food\t\tBank Contoh\t92.500', '2026-10-09\tApotek Contoh\t\tBank Contoh\t24.000', '2026-10-14\tToko Contoh\t\tBank Contoh\t118.000'];

test('Cashflow: picked Amount cells say their sum, the foot says the total shown, a column’s name sorts and Amount filters', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ROWS);
  await recordAll(page, 4);

  // The foot: every row shown and what they come to.
  const total = page.getByTestId('table-total');
  await expect(total).toContainText('4 shown');
  await expect(total).toContainText(/Total\s*Rp\s?272\.500/);

  // Three Amount cells dragged down: their sum and average above the table.
  await dragCells(page, cellOf(recordedRow(page, 'Grab Ride'), 'amount'), cellOf(recordedRow(page, 'Apotek Contoh'), 'amount'));
  await expect(page.locator('[data-cell="amount"][data-picked="true"]')).toHaveCount(3);
  await expect(page.getByTestId('table-note')).toContainText(/3 cells · Sum Rp\s?154\.500 · Average Rp\s?51\.500 · ⌘C copies/);
  await page.keyboard.press('Escape');

  // Amount's menu: High to low, the arrow after the name.
  const head = page.getByTestId('table-head');
  await head.getByRole('button', { name: /^Amount/ }).click();
  await page.getByRole('dialog', { name: 'Amount menu' }).getByRole('menuitemradio', { name: /High to low/ }).click();
  await expect(head.getByRole('button', { name: /^Amount ↓/ })).toBeVisible();
  expect(await notes(page)).toEqual(['Toko Contoh', 'Grab Food', 'Grab Ride', 'Apotek Contoh']);
  await expect(page.getByTestId('table-note')).toContainText('largest at the top');

  // Note's menu: A to Z.
  await head.getByRole('button', { name: /^Note/ }).click();
  await page.getByRole('dialog', { name: 'Note menu' }).getByRole('menuitemradio', { name: /A to Z/ }).click();
  expect(await notes(page)).toEqual(['Apotek Contoh', 'Grab Food', 'Grab Ride', 'Toko Contoh']);
  await expect(head.getByRole('button', { name: /^Amount/ })).not.toContainText('↓');

  // Amount's Over: the rows over it, the foot following them; ✕ takes it off.
  await head.getByRole('button', { name: /^Amount/ }).click();
  const menu = page.getByRole('dialog', { name: 'Amount menu' });
  await menu.getByRole('menuitemradio', { name: /^Over/ }).click();
  await menu.getByLabel('Amount over').fill('50000');
  await menu.getByLabel('Amount over').press('Enter');
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
  await expect(page.getByTestId('filter-amount')).toContainText(/Over Rp\s?50\.000/);
  await expect(total).toContainText('2 shown');
  await expect(total).toContainText(/Rp\s?210\.500/);
  await page.getByRole('button', { name: 'Clear the Amount filter' }).click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(4);

  // Date's menu puts the table back, oldest at the top.
  await head.getByRole('button', { name: /^Date/ }).click();
  await page.getByRole('dialog', { name: 'Date menu' }).getByRole('menuitemradio', { name: /Old to new/ }).click();
  expect(await notes(page)).toEqual(['Grab Ride', 'Grab Food', 'Apotek Contoh', 'Toko Contoh']);
});

test('the column names stay on top while a long month scrolls under them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  const lines = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}\tToko ${i + 1}\t\tBank Contoh\t${10 + i}.000`);
  await pasteRows(page, lines);
  await recordAll(page, 14);
  const head = page.getByTestId('table-head');
  await expect(head).toHaveCSS('position', 'sticky');
  await page.mouse.wheel(0, 900);
  await expect.poll(async () => Math.round((await head.boundingBox())!.y)).toBe(58);
  await expect(head).toHaveClass(/shadow-\[0_6px/);
  await expect(head.getByRole('button', { name: /^Amount/ })).toBeInViewport();
});

test('Review: the Amount name sorts and filters the queue, the foot says the total, picked amounts their sum', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ROWS);
  await page.goto('/review');
  const rows = page.getByTestId('draft-row');
  await expect(rows).toHaveCount(4);
  const total = page.getByTestId('table-total');
  await expect(total).toContainText('4 shown');
  await expect(total).toContainText(/Rp\s?272\.500/);

  const head = page.getByTestId('review-head');
  await head.getByRole('button', { name: /^Amount/ }).click();
  await page.getByRole('dialog', { name: 'Amount menu' }).getByRole('menuitemradio', { name: /Low to high/ }).click();
  await expect(rows.first().getByLabel('Row description')).toHaveValue('Apotek Contoh');
  await expect(rows.last().getByLabel('Row description')).toHaveValue('Toko Contoh');

  // Category's menu sorts too, above its filter.
  await head.getByRole('button', { name: /^Date/ }).click();
  await page.getByRole('dialog', { name: 'Date filter' }).getByRole('menuitemradio', { name: /Old to new/ }).click();
  await expect(rows.first().getByLabel('Row description')).toHaveValue('Grab Ride');

  await head.getByRole('button', { name: /^Amount/ }).click();
  const menu = page.getByRole('dialog', { name: 'Amount menu' });
  await menu.getByRole('menuitemradio', { name: /^Under/ }).click();
  await menu.getByLabel('Amount under').fill('50000');
  await menu.getByLabel('Amount under').press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('review-shown')).toContainText('2 of 4 shown');
  await expect(total).toContainText(/Rp\s?62\.000/);

  await dragCells(page, cellOf(rows.first(), 'amount'), cellOf(rows.last(), 'amount'));
  await expect(page.getByTestId('table-note')).toContainText(/2 cells · Sum Rp\s?62\.000 · Average Rp\s?31\.000/);
});
