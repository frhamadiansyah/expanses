import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { cellOf, copyHere, dragCells, pasteHere, pasteRows, recordAll, recordedRow } from './table-extras';

/*
 * The Mac tables' Sheets and Notion behaviours (owner 2026-11-25), second drop: the right-click menu, Space as quick
 * look, the jump keys, and ⌘Z / ⇧⌘Z for any change made in the table. Every figure and place is invented.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-10-20T12:00:00'));
});

const ROWS = ['2026-10-03\tGrab Ride\t\tBank Contoh\t38.000', '2026-10-05\tGrab Food\t\tBank Contoh\t92.500', '2026-10-09\tApotek Contoh\t\tBank Contoh\t24.000', '2026-10-14\tToko Contoh\t\tBank Contoh\t118.000'];

test('a right-click on a recorded row’s cell opens the table’s menu with what the row can do, keys on the right', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ROWS);
  await recordAll(page, 4);

  await cellOf(recordedRow(page, 'Grab Food'), 'description').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Row menu' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([/^Copy\s*⌘C$/, /^Paste\s*⌘V$/, /^Open\s*Space$/, /^Duplicate\s*⌘D$/, /^Split…$/, /^Delete\s*⌫$/]);
  // The cell right-clicked is picked.
  await expect(cellOf(recordedRow(page, 'Grab Food'), 'description')).toHaveAttribute('data-picked', 'true');
  await menu.getByRole('menuitem', { name: /^Copy/ }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Grab Food');

  // Open: the row's peek.
  await cellOf(recordedRow(page, 'Apotek Contoh'), 'amount').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /^Open/ }).click();
  await expect(page.getByTestId('cashflow-peek').getByTestId('peek-title')).toHaveText('Apotek Contoh');
  await page.getByTestId('cashflow-peek').getByRole('button', { name: 'Close' }).click();

  // Esc closes the menu, the arrows go along it; Delete asks twice.
  await cellOf(recordedRow(page, 'Toko Contoh'), 'paid').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await cellOf(recordedRow(page, 'Toko Contoh'), 'paid').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(menu.getByRole('menuitem', { name: 'Click again to delete' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Click again to delete' }).click();
  await expect(recordedRow(page, 'Toko Contoh')).toHaveCount(0);

  // Duplicate opens the duplicate form, as the peek's Duplicate does.
  await cellOf(recordedRow(page, 'Grab Ride'), 'date').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /^Duplicate/ }).click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/duplicate/);
});

test('Space on a picked cell opens its row’s peek, ↑ ↓ step it, Space closes; the jump keys and ⌘A pick across the column', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ROWS);
  await recordAll(page, 4);

  // A cell picked (a right-click picks it; Esc puts the menu away).
  await cellOf(recordedRow(page, 'Grab Ride'), 'description').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(cellOf(recordedRow(page, 'Grab Ride'), 'description')).toHaveAttribute('data-picked', 'true');
  const peek = page.getByTestId('cashflow-peek');
  await page.keyboard.press('Space');
  await expect(peek.getByTestId('peek-title')).toHaveText('Grab Ride');
  await page.keyboard.press('ArrowDown');
  await expect(peek.getByTestId('peek-title')).toHaveText('Grab Food');
  await expect(cellOf(recordedRow(page, 'Grab Food'), 'description')).toHaveAttribute('data-picked', 'true');
  await page.keyboard.press('Space');
  await expect(peek).toHaveCount(0);

  // ⌘↓ the column's last row, ⌘↑ its first; End the row's last cell, Home its first.
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect(cellOf(recordedRow(page, 'Toko Contoh'), 'description')).toHaveAttribute('data-picked', 'true');
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await expect(cellOf(recordedRow(page, 'Grab Ride'), 'description')).toHaveAttribute('data-picked', 'true');
  await page.keyboard.press('End');
  await expect(cellOf(recordedRow(page, 'Grab Ride'), 'amount')).toHaveAttribute('data-picked', 'true');
  await page.keyboard.press('Home');
  await expect(cellOf(recordedRow(page, 'Grab Ride'), 'date')).toHaveAttribute('data-picked', 'true');
  // ⌘A: the whole column, the rows shown.
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('[data-cell="amount"][data-picked="true"]')).toHaveCount(4);
  await expect(page.getByTestId('table-note')).toContainText(/4 cells · Sum Rp\s?272\.500/);
});

test('⌘Z puts back the last change in the table — a paste, a cell typed, rows discarded — and ⇧⌘Z makes it again', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ['2026-10-14\tWarung Satu\t\tBank Contoh\t21.000', '2026-10-15\tWarung Dua\t\tBank Contoh\t23.000', '2026-10-16\tWarung Tiga\t\tBank Contoh\t25.000']);
  const draft = (note: string) => page.getByTestId('not-recorded-row').filter({ has: page.locator(`input[value="${note}"]`) });

  // A paste into two Category cells.
  await dragCells(page, cellOf(draft('Warung Satu'), 'category'), cellOf(draft('Warung Dua'), 'category'));
  await pasteHere(page, 'Groceries');
  await expect(draft('Warung Satu').getByLabel('Row category')).toHaveValue('Groceries');
  await expect(draft('Warung Dua').getByLabel('Row category')).toHaveValue('Groceries');
  expect(await copyHere(page)).toBe('Groceries\nGroceries');
  await expect(page.getByTestId('cell-change')).toContainText('Changed 2 cells');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(draft('Warung Satu').getByLabel('Row category')).toHaveValue('');
  await expect(draft('Warung Dua').getByLabel('Row category')).toHaveValue('');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(draft('Warung Satu').getByLabel('Row category')).toHaveValue('Groceries');
  await expect(draft('Warung Dua').getByLabel('Row category')).toHaveValue('Groceries');
  await page.keyboard.press('Escape');

  // A cell typed in and left.
  await draft('Warung Tiga').getByLabel('Row description').fill('Warung Empat');
  await page.getByRole('heading', { name: 'Cashflow', level: 1 }).click();
  await expect(draft('Warung Empat')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(draft('Warung Tiga')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(draft('Warung Empat')).toHaveCount(1);

  // Rows discarded (⌫), brought back by ⌘Z, discarded again by ⇧⌘Z.
  await draft('Warung Dua').getByLabel('Row date').click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  await page.getByRole('heading', { name: 'Cashflow', level: 1 }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(2);
  // Then the paste before it, the change under it on the stack.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(draft('Warung Tiga')).toHaveCount(1);
});

test('Review: a right-click offers Copy, Paste, Open and Discard; Space opens the peek; ⌘Z puts a paste back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ROWS);
  await page.goto('/review');
  const rows = page.getByTestId('draft-row');
  await expect(rows).toHaveCount(4);
  const kopi = rows.filter({ has: page.locator('input[value="Apotek Contoh"]') });
  await cellOf(kopi, 'amount').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Row menu' });
  await expect(menu.getByRole('menuitem')).toHaveText([/^Copy\s*⌘C$/, /^Paste\s*⌘V$/, /^Open\s*Space$/, /^Discard\s*⌫$/]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('peek-title')).toContainText('Apotek Contoh');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('peek-title')).toHaveCount(0);

  await pasteHere(page, '30.000');
  await expect(kopi.getByLabel(/Row amount/)).toHaveValue(/30\.000/);
  await expect(page.getByTestId('cell-change')).toContainText('Changed 1 cell');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(kopi.getByLabel(/Row amount/)).toHaveValue(/24\.000/);
});
