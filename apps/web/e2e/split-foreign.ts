import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, fillFigure, saveButton } from './add-transaction';
import { addPart, donePart, openPart, openSplit, pickPartCategory, splitSheet } from './split-row';

/**
 * A split bought in another currency (option C, owner 22 Nov 2026), the same journey at both widths: an invented hotel
 * bill of USD 120,00 on an IDR card, charged Rp 1.944.000, split in two by typing USD 80 into the first part. The second
 * part — the Rest — is what is left in both: USD 40,00 and Rp 648.000. Saved, the receipt lists both parts in rupiah with
 * each one's share of the USD figure under it.
 *
 * No exchange rate reaches a test run, so the charged figure is typed, as the bank's own figure would be.
 */
export async function splitForeignJourney(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'credit_card', name: 'BCA Visa' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'BCA Visa');
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await fillFigure(form, 'Amount', '120');
  await fillFigure(form, 'Charged in IDR', '1944000');
  await form.getByLabel('Note').fill('Hotel Contoh');
  await form.getByRole('button', { name: 'Add more details' }).click();

  await openSplit(page);
  const split = splitSheet(page);
  // The Total is what posts, with the foreign whole under it.
  await expect(split.getByTestId('split-total')).toContainText('1.944.000');
  await expect(split.getByTestId('split-total-original')).toContainText('120,00');
  await addPart(page);
  const parts = split.getByTestId('split-row');
  await expect(parts).toHaveCount(2);
  await pickPartCategory(page, 1, 'Groceries');
  await pickPartCategory(page, 2, 'Restaurants');

  // Part one typed in USD: its rupiah is worked out at the whole charge's rate (16.200 to the dollar), shown with ≈.
  const one = await openPart(page, 1);
  await one.getByLabel('In USD', { exact: true }).fill('80');
  await expect(one.getByLabel('Amount', { exact: true })).toHaveValue('1.296.000');
  await expect(one.getByText('≈ IDR', { exact: true })).toBeVisible();
  await donePart(page);
  await expect(parts.nth(0)).toContainText('1.296.000');
  await expect(parts.nth(0).getByTestId('split-row-original')).toContainText('80,00');

  // Part two is the Rest, in both figures.
  await expect(parts.nth(1)).toContainText('648.000');
  await expect(parts.nth(1).getByTestId('split-row-original')).toContainText('40,00');
  const two = await openPart(page, 2);
  await expect(two.getByLabel('Amount', { exact: true })).toHaveValue('648.000');
  await expect(two.getByLabel('In USD', { exact: true })).toHaveValue('40,00');
  await donePart(page);
  await expect(split.getByTestId('split-status')).toHaveText('All of it assigned');

  await split.getByRole('button', { name: 'Close' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // The receipt: each part in rupiah, its share of the USD figure under it, and the whole's Original amount.
  await page.goto('/transactions');
  // A desktop's row opens the receipt from its own link (a click on the row edits it in place); a phone's row is the link.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Hotel Contoh' }).first();
  await expect(row).toBeVisible();
  const link = page.getByRole('link', { name: 'Receipt for Hotel Contoh' });
  if ((await link.count()) > 0) await link.first().click();
  else await row.click();
  await expect(page.getByTestId('hero-amount')).toContainText('1.944.000');
  const receiptParts = page.getByTestId('split-part');
  await expect(receiptParts).toHaveCount(2);
  await expect(receiptParts.nth(0)).toContainText('Groceries');
  await expect(receiptParts.nth(0)).toContainText('1.296.000');
  await expect(receiptParts.nth(0).getByTestId('split-part-original')).toContainText('80,00');
  await expect(receiptParts.nth(1)).toContainText('Restaurants');
  await expect(receiptParts.nth(1)).toContainText('648.000');
  await expect(receiptParts.nth(1).getByTestId('split-part-original')).toContainText('40,00');
  await expect(page.locator('div', { hasText: /^Original amount/ }).last()).toContainText('120,00');
}
