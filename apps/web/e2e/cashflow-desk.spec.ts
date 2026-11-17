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
