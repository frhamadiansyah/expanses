import { expect, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: import('@playwright/test').Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

test('the phone types money on the dock, and has four ways off it', async ({ page }) => {
  await addWallet(page);
  // The card on its own route, so Escape is answered by the dock alone: inside a sheet it would also be the
  // sheet's own way out, and the two would be indistinguishable.
  await page.goto('/transactions/new');

  const amount = page.getByRole('button', { name: 'Amount', exact: true });
  // §3.4: no text input at all on a phone — the figure is a button, and the dock is the only way into it.
  await expect(amount).toBeVisible();
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeHidden();

  // The ✕ in the dock's corner.
  await amount.click();
  await expect(keypad).toBeVisible();
  await keypad.getByRole('button', { name: 'Close keypad' }).click();
  await expect(keypad).toBeHidden();

  // Escape.
  await amount.click();
  await expect(keypad).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keypad).toBeHidden();

  // The page behind it.
  await amount.click();
  await expect(keypad).toBeVisible();
  await page.mouse.click(195, 90);
  await expect(keypad).toBeHidden();

  // The row itself, tapped a second time. The dock covers the Save button while it is open, so a row that
  // could not put it away again would be a form with no way to finish.
  await amount.click();
  await expect(keypad).toBeVisible();
  await amount.click();
  await expect(keypad).toBeHidden();

  // And what it is all for: the digits land on the row, in the row's own currency.
  await amount.click();
  for (const digit of '450000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toBeHidden();
  await expect(amount).toHaveText('450000');
});

test('a purchase recorded by thumb reaches the list', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '500000' });
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('500.000');
});
