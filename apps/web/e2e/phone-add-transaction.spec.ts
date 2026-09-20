import { expect, test } from '@playwright/test';
import { addTransaction, attachPhoto, closeDetails } from './add-transaction';

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

/**
 * A receipt photographed and attached by thumb, and on the transaction the moment it is saved.
 *
 * The one flow this task can prove on the phone project on its own; Task 18 grows this file into the full phone
 * pass. The library input is driven rather than the camera one, because Playwright cannot answer a `capture`
 * prompt — what the phone proves here is that the sheet, the grid and the strip are reachable and legible at
 * 390px, which is exactly what a desktop run cannot say.
 */
test('a photograph attached by thumb is on the receipt', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });

  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const digit of '85000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  const { more, sheet } = await attachPhoto(page, form, { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a receipt') });
  await expect(sheet.getByText('Photos stay on this device with the transaction and go into your backups.')).toBeVisible();
  await closeDetails(more, sheet);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // A phone reaches a receipt by tapping the row's face; the ⓘ the desktop uses is `hidden md:inline-flex`.
  await page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).getByRole('button', { name: /^Groceries/ }).click();
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  await expect(picture).toBeVisible();
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a receipt');
});
