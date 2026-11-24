import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

/*
 * Mac Review's header filters (owner 2026-11-24): the column names narrow the waiting rows — Note by words, When by
 * From / To — and the rows shown are fixed together: ⌘-click picks Note cells apart from each other, a letter opens one
 * value for them all, Return gives one category for all, and Record N records only the rows shown. Invented rows.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-10-20T12:00:00'));
});

/** Pastes rows into Cashflow's typing row as ⌘V does: they wait there and in Review alike. */
async function pasteInto(page: Page, text: string) {
  await expect(page.getByTestId('typing-row').getByLabel('Row payment method')).toBeEnabled();
  await page.getByTestId('typing-row').getByLabel('Row description').evaluate((input, plain) => {
    const data = new DataTransfer();
    data.setData('text/plain', plain);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const ROWS = [
  '2026-09-03\tGrab\t\tBank Contoh\t38.000',
  '2026-09-05\tGrab\t\tBank Contoh\t92.500',
  '2026-09-09\tGrab\t\tBank Contoh\t24.000',
  '2026-09-10\tToko Contoh\t\tBank Contoh\t51.000',
  '2026-09-14\tGrab\t\tBank Contoh\t118.000',
  '2026-09-21\tGrab\t\tBank Contoh\t31.500',
  '2026-09-27\tGrab\t\tBank Contoh\t76.000',
  '2026-09-12\tKedai Contoh\t\tBank Contoh\t44.000',
  '2026-10-02\tGrab\t\tBank Contoh\t27.000',
];

test('the Note and When headers narrow Review to Grab in September; three Note cells picked apart take one value and one category; Record N records only the rows shown', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  await pasteInto(page, ROWS.join('\n'));
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(9);
  await page.goto('/review');
  const rows = page.getByTestId('draft-row');
  await expect(rows).toHaveCount(9);
  const table = page.getByTestId('review-table');

  // Note: the header turns into a search field that narrows as typed, any case.
  await table.getByRole('button', { name: 'Note' }).click();
  await table.getByLabel('Filter by note').fill('GRAB');
  await expect(rows).toHaveCount(7);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('filter-note')).toContainText('GRAB');
  await expect(page.getByTestId('review-shown')).toContainText('7 of 9 shown');

  // When: From and To, both days kept.
  await table.getByRole('button', { name: 'When' }).click();
  const when = page.getByRole('dialog', { name: 'When filter' });
  await when.getByLabel('From date').fill('2026-09-01');
  await when.getByLabel('To date').fill('2026-09-30');
  await page.keyboard.press('Escape');
  await expect(when).toHaveCount(0);
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId('filter-when')).toContainText('When: 1–30 Sep');
  await expect(page.getByTestId('review-shown')).toContainText('6 of 9 shown');
  await expect(table.getByRole('button', { name: 'Record 6' })).toBeVisible();

  // Newest first: 27, 21, 14, 9, 5, 3 Sep. ⌘-click picks the 21st's, 9th's and 3rd's Note cells, apart from each other.
  const rides = [1, 3, 5];
  for (const at of rides) await rows.nth(at).locator('[data-cell="description"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-cell="description"][data-picked="true"]')).toHaveCount(3);
  await expect(page.getByTestId('review-peek')).toHaveCount(0);

  // A letter opens one value for the three, begun with it; Return puts it in each.
  await page.keyboard.press('G');
  const bulk = page.getByRole('dialog', { name: 'Note for 3 rows' });
  await expect(bulk.getByRole('textbox')).toHaveValue('G');
  await page.keyboard.type('rabRide');
  await page.screenshot({ path: test.info().outputPath('review-bulk.png') });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cell-change')).toContainText('Changed 3 cells');
  for (const at of rides) await expect(rows.nth(at).locator('[data-cell="description"]')).toContainText('GrabRide');
  await expect(rows.nth(0).locator('[data-cell="description"]')).not.toContainText('GrabRide');

  // Undo puts the three back; done again, they stay.
  await page.getByTestId('cell-change').getByRole('button', { name: 'Undo' }).click();
  await expect(rows.filter({ hasText: 'GrabRide' })).toHaveCount(0);
  for (const at of rides) await rows.nth(at).locator('[data-cell="description"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-cell="description"][data-picked="true"]')).toHaveCount(3);
  await page.keyboard.type('GrabRide');
  await page.keyboard.press('Enter');
  await expect(rows.filter({ hasText: 'GrabRide' })).toHaveCount(3);

  // Their Category cells, picked apart the same way: Return gives one picker for the three.
  for (const at of rides) await rows.nth(at).locator('[data-cell="category"]').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-cell="category"][data-picked="true"]')).toHaveCount(3);
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Category for 3 captures' });
  await picker.getByRole('button', { name: 'Ride hailing', exact: true }).click();
  await expect(page.getByTestId('cell-change')).toContainText('Changed 3 cells');
  for (const at of rides) await expect(rows.nth(at).locator('[data-cell="category"]')).toContainText('Ride hailing');

  // Record 6 records the six shown, and only those; Show all brings back the three left out.
  await table.getByRole('button', { name: 'Record 6' }).click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId('review-shown').getByRole('button', { name: 'Show all' }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('review-shown')).toHaveCount(0);
  for (const note of ['Toko Contoh', 'Kedai Contoh']) await expect(rows.filter({ hasText: note })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Grab' })).toHaveCount(1);
});
