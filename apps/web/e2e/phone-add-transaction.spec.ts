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

/**
 * Escape closes the innermost thing open, and the draft behind it survives.
 *
 * The sheet and the dock inside it both listen for Escape on the document. One press used to be answered by
 * both: the dock shut, the sheet shut behind it, and a transaction typed to its last digit was gone with
 * nothing to get it back. The first test in this file works on `/transactions/new` precisely to avoid this;
 * here is the sheet path it was avoiding.
 */
test('Escape inside the sheet puts the dock away and keeps what was typed', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await expect(form).toBeVisible();

  const amount = form.getByRole('button', { name: 'Amount', exact: true });
  await amount.click();
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeVisible();
  for (const digit of '450000') await keypad.getByRole('button', { name: digit, exact: true }).click();

  // One press: the dock, and nothing behind it.
  await page.keyboard.press('Escape');
  await expect(keypad).toBeHidden();
  await expect(form).toBeVisible();
  await expect(amount).toHaveText('450000');

  // A second press is the sheet's own way out, which is what Escape was always for once the dock is gone.
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
});
