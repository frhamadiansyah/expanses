import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

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
