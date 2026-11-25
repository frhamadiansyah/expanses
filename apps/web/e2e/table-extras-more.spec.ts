import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { cellOf, copyHere, dragCells, notes, pasteHere, pasteRows, recordAll, recordedRow } from './table-extras';

/*
 * The Mac tables' Sheets and Notion behaviours (owner 2026-11-25), third drop: Group by in the table's ⋯ menu, Find
 * and replace (⇧⌘H), and a block picked across columns, copied and pasted as a little table. Every figure and place
 * is invented.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-10-20T12:00:00'));
});

const draft = (page: Page, note: string) => page.getByTestId('not-recorded-row').filter({ has: page.locator(`input[value="${note}"]`) });

test('Group by Category: each group says its count and total, a click on its name folds it; None is the table again', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ['2026-10-03\tGrab Ride\tTransport\tBank Contoh\t38.000', '2026-10-05\tGrab Food\tRestaurants\tBank Contoh\t92.500', '2026-10-09\tGrab Ride\tTransport\tBank Contoh\t24.000', '2026-10-14\tGrab Food\tRestaurants\tBank Contoh\t118.000']);
  await recordAll(page, 4);

  await page.getByRole('button', { name: 'More for the table' }).click();
  await page.getByRole('dialog', { name: 'Table menu' }).getByRole('menuitemradio', { name: 'Category' }).click();
  const heads = page.getByTestId('group-head');
  await expect(heads).toHaveCount(2);
  // Largest first: Restaurants (Rp 210.500), then Transport (Rp 62.000).
  await expect(heads.nth(0)).toContainText('Restaurants');
  await expect(heads.nth(0).getByTestId('group-count')).toHaveText('2');
  await expect(heads.nth(0).getByTestId('group-total')).toHaveText(/Rp\s?210\.500/);
  await expect(heads.nth(1).getByTestId('group-total')).toHaveText(/Rp\s?62\.000/);
  expect(await notes(page)).toEqual(['Grab Food', 'Grab Food', 'Grab Ride', 'Grab Ride']);

  // A click on the group's name folds it; the total under the table still counts it.
  await heads.nth(0).getByRole('button').click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
  await expect(page.getByTestId('table-total')).toContainText(/Rp\s?272\.500/);
  await heads.nth(0).getByRole('button').click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(4);

  // By day: a group a day, along the calendar.
  await page.getByRole('button', { name: 'More for the table' }).click();
  await page.getByRole('dialog', { name: 'Table menu' }).getByRole('menuitemradio', { name: 'Day' }).click();
  await expect(heads).toHaveCount(4);
  await page.getByRole('button', { name: 'More for the table' }).click();
  await page.getByRole('dialog', { name: 'Table menu' }).getByRole('menuitemradio', { name: 'None' }).click();
  await expect(heads).toHaveCount(0);
  expect(await notes(page)).toEqual(['Grab Ride', 'Grab Food', 'Grab Ride', 'Grab Food']);
});

test('Find and replace (⇧⌘H): the words found are marked and counted; Replace on picked, Replace all, and one ⌘Z puts it back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ['2026-10-03\tGrab Ride\t\tBank Contoh\t38.000', '2026-10-05\tGrab Food\t\tBank Contoh\t92.500', '2026-10-09\tApotek Contoh\t\tBank Contoh\t24.000', '2026-10-14\tgrab bike\t\tBank Contoh\t18.000']);
  await recordAll(page, 4);

  await page.keyboard.press('ControlOrMeta+Shift+h');
  const bar = page.getByTestId('find-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByLabel('Find', { exact: true })).toBeFocused();
  await page.keyboard.type('grab');
  await expect(bar.getByTestId('find-count')).toHaveText('3 found');
  await expect(page.locator('mark[data-found]')).toHaveCount(3);

  // A row ⌘-clicked is a picked row: Replace on picked changes it alone.
  await recordedRow(page, 'Grab Food').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar.getByTestId('find-count')).toHaveText('3 found · 1 on picked row');
  await bar.getByLabel('Replace', { exact: true }).fill('Gojek');
  await bar.getByRole('button', { name: 'Replace on picked' }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 1 cell');
  await expect(recordedRow(page, 'Gojek Food')).toHaveCount(1);
  await expect(bar.getByTestId('find-count')).toHaveText('2 found');

  await bar.getByRole('button', { name: 'Replace all 2' }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 2 cells');
  expect(await notes(page)).toEqual(['Gojek Ride', 'Gojek Food', 'Apotek Contoh', 'Gojek bike']);

  // One ⌘Z puts the whole replace back (the one on picked stays: it was a change of its own).
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await page.getByRole('heading', { name: 'Cashflow', level: 1 }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => notes(page)).toEqual(['Grab Ride', 'Gojek Food', 'Apotek Contoh', 'grab bike']);

  // Category: the cells found are tinted, and Replace gives them the new name whole.
  await page.getByRole('button', { name: 'More for the table' }).click();
  await page.getByRole('dialog', { name: 'Table menu' }).getByRole('button', { name: /Find and replace/ }).click();
  await bar.getByLabel('Find in').selectOption('category');
  await bar.getByLabel('Find', { exact: true }).fill('uncat');
  await expect(bar.getByTestId('find-count')).toHaveText('4 found');
  await bar.getByLabel('Replace', { exact: true }).fill('Groceries');
  await bar.getByRole('button', { name: 'Replace all 4' }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 4 cells');
  await expect(recordedRow(page, 'Apotek Contoh')).toContainText('Groceries');
});

test('a block across columns: a drag from Category to Paid with picks rows × columns, ⌘C copies it as a table, ⌘V of it fills both columns', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await openAccount(page, { subtype: 'bank', name: 'Bank Lain', balance: '9000000' });
  await page.goto('/transactions');
  await pasteRows(page, ['2026-10-14\tToko A\tGroceries\tBank Contoh\t21.000', '2026-10-15\tToko B\tRestaurants\tBank Lain\t23.000', '2026-10-16\tToko C\t\t\t25.000', '2026-10-17\tToko D\t\t\t27.000']);

  await dragCells(page, cellOf(draft(page, 'Toko A'), 'category'), cellOf(draft(page, 'Toko B'), 'paid'));
  await expect(page.locator('[data-picked="true"]')).toHaveCount(4);
  await expect(page.getByTestId('table-note')).toHaveText('2 rows × 2 columns · ⌘C copies · ⌘V pastes');
  const copied = await copyHere(page);
  expect(copied).toBe('Groceries\tBank Contoh\nRestaurants\tBank Lain');
  await page.keyboard.press('Escape');

  // Two Category cells picked, the two-column copy pasted: Category and Paid with fill at once.
  await dragCells(page, cellOf(draft(page, 'Toko C'), 'category'), cellOf(draft(page, 'Toko D'), 'category'));
  await pasteHere(page, copied);
  await expect(draft(page, 'Toko C').getByLabel('Row category')).toHaveValue('Groceries');
  await expect(draft(page, 'Toko C').getByLabel('Row payment method')).toHaveValue(/Bank Contoh/);
  await expect(draft(page, 'Toko D').getByLabel('Row category')).toHaveValue('Restaurants');
  await expect(draft(page, 'Toko D').getByLabel('Row payment method')).toHaveValue(/Bank Lain/);
  await expect(page.getByTestId('cell-change')).toContainText('Changed 4 cells');

  // ⇧→ after ⇧↓: the same block from the keyboard.
  await page.keyboard.press('Escape');
  await draft(page, 'Toko A').getByLabel('Row category').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('table-note')).toHaveText('2 rows × 2 columns · ⌘C copies · ⌘V pastes');
  expect(await copyHere(page)).toBe('Groceries\tBank Contoh\nRestaurants\tBank Lain');
});
