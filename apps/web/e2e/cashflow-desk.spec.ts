import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { peekBill, peekButton } from './bills-desk';

/*
 * The wide screen's Cashflow (Mac Cashflow D, 2026-11-17): three boxes, the typing table across the full width, and a
 * side peek. A row is typed in the top row and saved with Return; a click opens its peek, Esc closes it, ⌃ ⌄ step, and a
 * double-click opens the full edit screen.
 */

async function pick(row: Locator, label: string, text: string) {
  const cell = row.getByLabel(label);
  await expect(cell).toBeEnabled();
  await cell.fill(text);
  await cell.press('Enter');
}

async function typeRow(page: Page, description: string, amount: string, category: string) {
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').fill(description);
  await pick(typing, 'Row category', category);
  await pick(typing, 'Row paid with', 'bca');
  await typing.getByLabel('Row amount (IDR)').fill(amount);
  await typing.getByLabel('Row amount (IDR)').press('Enter');
  await expect(page.getByTestId('transaction-row').filter({ hasText: description })).toHaveCount(1);
}

test('a row typed in the top row is saved with Return, counted in the boxes, and its peek opens, steps and closes', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { name: 'Cashflow', level: 1 })).toBeVisible();

  // Tab moves along the typing row in the table's own column order: Date, Note, Category, Paid with, then Amount.
  const typing = page.getByTestId('typing-row');
  await expect(typing.getByLabel('Row category')).toBeEnabled();
  await typing.getByLabel('Row description').focus();
  await page.keyboard.press('Tab');
  await expect(typing.getByLabel('Row category')).toBeFocused();

  await typeRow(page, 'Superindo', '450000', 'groceries');
  await typeRow(page, 'Kopi Kenangan', '38000', 'cafe');

  const superindo = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  await expect(superindo).toContainText('Groceries');
  await expect(superindo).toContainText('BCA Tahapan');
  await expect(superindo).toContainText('Essential');
  await expect(superindo).toContainText('450.000');
  // The boxes read the same month: the ring names Household (Groceries' top level, as the phone's ring), This month has both spent.
  await expect(page.getByTestId('cashflow-ring').getByRole('button', { name: /Household/ })).toBeVisible();
  await expect(page.getByTestId('month-spent')).toContainText('488.000');
  await expect(page.getByTestId('period-total')).toContainText('488.000');

  // A click opens the peek on the row.
  await superindo.click();
  const peek = page.getByTestId('cashflow-peek');
  await expect(peek).toBeVisible();
  await expect(peek.getByTestId('peek-title')).toHaveText('Superindo');
  await expect(peek).toContainText('450.000');
  await expect(peek).toContainText('Groceries');
  await expect(superindo).toHaveAttribute('aria-current', 'true');

  // ⌃ ⌄ and the arrow keys step through the table's rows (newest first: Kopi Kenangan was typed last, same day).
  const titles = await page.getByTestId('transaction-row').allInnerTexts();
  const other = titles.findIndex((text) => text.includes('Kopi Kenangan')) < titles.findIndex((text) => text.includes('Superindo')) ? 'Previous transaction' : 'Next transaction';
  await peek.getByRole('button', { name: other }).click();
  await expect(peek.getByTestId('peek-title')).toHaveText('Kopi Kenangan');
  await page.keyboard.press(other === 'Next transaction' ? 'ArrowUp' : 'ArrowDown');
  await expect(peek.getByTestId('peek-title')).toHaveText('Superindo');

  // Esc closes it.
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);

  // Clicking a category in the ring filters the table to it; a second click lets go.
  const household = page.getByTestId('cashflow-ring').getByRole('button', { name: /Household/ });
  await household.click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await household.click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
});

test('a double-click opens the full edit screen, and Delete in the peek asks twice', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await typeRow(page, 'Superindo', '450000', 'groceries');

  await page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).dblclick();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/edit$/);
  await expect(page.getByRole('form', { name: 'Edit a transaction' })).toBeVisible();

  await page.goto('/transactions');
  await page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).click();
  const peek = page.getByTestId('cashflow-peek');
  await peek.getByRole('button', { name: 'Delete this transaction' }).click();
  await peek.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(peek).toHaveCount(0);
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
});

/** Makes a workspace from App settings and lands in it, as the sheet does on its own. */
async function newWorkspace(page: Page, name: string) {
  await page.getByRole('link', { name: 'App settings', exact: true }).click();
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

/** Opens a workspace from the sidebar's switcher. */
async function switchTo(page: Page, name: string) {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
  await page.goto('/transactions');
}

const tableRow = (page: Page, description: string) => page.getByTestId('transaction-row').filter({ hasText: description });

test('⌘-click picks two rows, and Move to workspace in their peek moves them both', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await newWorkspace(page, 'Business');
  await switchTo(page, 'Personal');
  await typeRow(page, 'Supplier dinner', '640000', 'restaurants');
  await typeRow(page, 'Client lunch', '210000', 'restaurants');
  await typeRow(page, 'Kopi Kenangan', '38000', 'cafe');

  // A click picks one row (its peek); ⌘-click adds a second, and the peek becomes the two together.
  await tableRow(page, 'Supplier dinner').click();
  await expect(page.getByTestId('cashflow-peek')).toBeVisible();
  await tableRow(page, 'Client lunch').click({ modifiers: ['ControlOrMeta'] });
  const picked = page.getByTestId('cashflow-selection');
  await expect(picked.getByTestId('peek-title')).toHaveText('2 selected');
  await expect(picked.getByTestId('selection-total')).toContainText('850.000');
  await expect(page.getByTestId('cashflow-peek')).toHaveCount(0);
  await expect(tableRow(page, 'Supplier dinner')).toHaveAttribute('aria-current', 'true');
  await expect(tableRow(page, 'Client lunch')).toHaveAttribute('aria-current', 'true');
  await expect(tableRow(page, 'Kopi Kenangan')).not.toHaveAttribute('aria-current', 'true');

  await picked.getByRole('button', { name: 'Move to workspace' }).click();
  await page.getByRole('dialog', { name: 'Move to workspace' }).getByRole('button', { name: 'Business' }).click();
  await expect(tableRow(page, 'Supplier dinner')).toHaveCount(0);
  await expect(tableRow(page, 'Client lunch')).toHaveCount(0);
  await expect(tableRow(page, 'Kopi Kenangan')).toHaveCount(1);
  await expect(picked).toHaveCount(0);

  await switchTo(page, 'Business');
  await expect(tableRow(page, 'Supplier dinner')).toContainText('640.000');
  await expect(tableRow(page, 'Client lunch')).toContainText('210.000');
});

test('⇧-click picks a range, Esc lets it go, ⌘A picks every row, and Delete asks twice for them all', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await typeRow(page, 'Superindo', '450000', 'groceries');
  await typeRow(page, 'Kopi Kenangan', '38000', 'cafe');
  await typeRow(page, 'Apotek K24', '85000', 'pharm');

  const rows = page.getByTestId('transaction-row');
  await rows.first().click();
  await rows.last().click({ modifiers: ['Shift'] });
  const picked = page.getByTestId('cashflow-selection');
  await expect(picked.getByTestId('peek-title')).toHaveText('3 selected');
  await page.keyboard.press('Escape');
  await expect(picked).toHaveCount(0);
  await expect(page.locator('[data-testid="transaction-row"][aria-current="true"]')).toHaveCount(0);

  // ⌘A on the page (not in a field) picks every row listed.
  await page.getByRole('heading', { name: 'Cashflow', level: 1 }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(picked.getByTestId('peek-title')).toHaveText('3 selected');
  await expect(picked.getByTestId('selection-total')).toContainText('573.000');
  await picked.getByRole('button', { name: 'Delete 3 transactions' }).click();
  await picked.getByRole('button', { name: 'Click again to delete 3 transactions' }).click();
  await expect(picked).toHaveCount(0);
  await expect(rows).toHaveCount(0);
});

test('a yearly bill is listed greyed and left out of a month’s ring, boxes and bars; the Filter’s switch counts it, and a year does', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2027-03-05T12:00:00'));
  await openAccount(page, { subtype: 'bank', name: 'Contoh Tabungan', balance: '50000000' });

  // A yearly bill out on 5 March, paid from its peek on Mac Bills.
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Life cover premium');
  await page.getByLabel('Amount', { exact: true }).fill('12000000');
  await pickBillCategory(page, 'Life insurance');
  await pickBillPaidFrom(page, 'Contoh Tabungan');
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption('3');
  await page.getByLabel('Due by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await peekBill(page, 'Life cover premium');
  await peekButton(page, 'Pay').click();
  await page.getByRole('dialog', { name: 'Pay Life cover premium' }).getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('dialog', { name: 'Pay Life cover premium' })).toHaveCount(0);

  // Everyday spending the day before.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Contoh', paidWith: 'Contoh Tabungan', category: 'Restaurants', amount: '286000', date: '2027-03-04' });

  // March: the ring, Spent and the bars are the dinner alone; the bill is still listed, whole, greyed, with its tag.
  await expect(page.getByTestId('chart-month')).toHaveText(/March 2027/);
  const total = page.getByTestId('period-total');
  await expect(total).toHaveText(/^Rp\s286\.000$/);
  await expect(page.getByTestId('month-spent')).toHaveText(/^Rp\s286\.000$/);
  const premium = page.getByTestId('transaction-row').filter({ hasText: 'Life cover premium' });
  await expect(premium).toHaveAttribute('data-yearly-out', 'true');
  await expect(premium).toContainText('12.000.000');
  await expect(premium.getByTestId('yearly-tag')).toHaveText('Yearly bill');
  await expect(premium.getByTestId('yearly-tag')).toHaveAttribute('title', 'Yearly bill · in the year');
  await expect(page.getByTestId('yearly-bills-note')).toHaveText('1 yearly bill not in the ring');
  const bars = page.getByTestId('cashflow-days');
  await expect(bars.locator('[title*="12.000.000"]')).toHaveCount(0);
  await expect(bars.locator('[title*="286.000"]')).toHaveCount(1);

  // Its peek says which bill, and that the year counts it.
  await premium.click();
  await expect(page.getByTestId('cashflow-peek').getByTestId('yearly-note')).toHaveText('Life cover premium · Yearly bill · in the year');
  // Beside the peek the tag and the amount stay whole.
  await expect(premium.getByTestId('yearly-tag')).toHaveText('Yearly bill');
  await expect(premium).toContainText('12.000.000');
  await page.keyboard.press('Escape');

  // Filter: Yearly bills off, saying what that means; on, the month counts it like any spending.
  const filter = page.getByRole('button', { name: /^Filter/ });
  await filter.click();
  const yearly = page.getByTestId('yearly-bills-filter');
  await expect(yearly).toHaveAttribute('aria-checked', 'false');
  await expect(yearly).toContainText('Off: listed, not in the ring or total');
  await yearly.click();
  await expect(yearly).toHaveAttribute('aria-checked', 'true');
  await expect(total).toHaveText(/^Rp\s12\.286\.000$/);
  await expect(page.getByTestId('month-spent')).toHaveText(/^Rp\s12\.286\.000$/);
  await expect(bars.locator('[title*="12.000.000"]')).toHaveCount(1);
  await expect(page.getByTestId('yearly-bills-note')).toHaveCount(0);
  await expect(premium).not.toHaveAttribute('data-yearly-out', /.*/);
  await expect(premium.getByTestId('yearly-tag')).toHaveCount(0);
  await expect(filter).toHaveText(/Filter · 1/);
  // Clear filters puts it back off.
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('button', { name: 'Clear filters' }).click();
  await expect(total).toHaveText(/^Rp\s286\.000$/);

  // The year counts it, switch off; the switch says a year always counts them.
  await page.keyboard.press('Escape');
  await page.getByTestId('chart-month').click();
  const picker = page.getByTestId('period-picker');
  await picker.getByRole('tab', { name: 'Year' }).click();
  await picker.getByRole('button', { name: '2027', exact: true }).click();
  await expect(page.getByTestId('chart-month')).toHaveText(/2027/);
  await expect(total).toHaveText(/^Rp\s12\.286\.000$/);
  await expect(premium.getByTestId('yearly-tag')).toHaveCount(0);
  await filter.click();
  await expect(page.getByTestId('yearly-bills-filter')).toBeDisabled();
  await expect(page.getByTestId('yearly-bills-filter')).toContainText('A year always counts them');
});
