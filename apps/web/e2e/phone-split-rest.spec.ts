import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { addPart, donePart, fillPart, openPart, openSplit, pickPartCategory, splitSheet } from './split-row';

/*
 * A split by category with an amount on the card keeps its last part as the Rest: the total less the other parts, worked out
 * again as they change. Invented figures: Rp 250.000 at Pasar Baru on a bank account.
 */

test('the last part is the Rest: it follows the other parts, and an edit that would take it below nothing is refused', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'BCA Tahapan');
  await openAmount(form);
  await fillAmount(page, form, '250000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Pasar Baru');
  await form.getByRole('button', { name: 'Add more details' }).click();
  await openSplit(page);
  const split = splitSheet(page);
  const parts = split.getByTestId('split-row');
  await expect(split.getByTestId('split-total')).toContainText('250.000');

  // The first press makes two parts: Groceries with the whole amount, and a Rest of nothing (not labelled).
  await addPart(page);
  await expect(parts).toHaveCount(2);
  await fillPart(page, 1, '120000');
  await expect(parts.nth(1)).toContainText('130.000');
  await pickPartCategory(page, 2, 'Household');

  // A third part is the new Rest; the part before it keeps its figure until it is changed.
  await addPart(page);
  await pickPartCategory(page, 3, 'Restaurants');
  await fillPart(page, 2, '80000');
  await expect(parts.nth(0)).toContainText('120.000');
  await expect(parts.nth(1)).toContainText('80.000');
  await expect(parts.nth(2)).toContainText('50.000');
  await expect(split.getByTestId('split-status')).toHaveCount(0);

  // Groceries to 150.000: the Rest falls to 20.000 on its own.
  await fillPart(page, 1, '150000');
  await expect(parts.nth(0)).toContainText('150.000');
  await expect(parts.nth(2)).toContainText('20.000');
  await expect(split.getByTestId('split-total')).toContainText('250.000');

  // Too much for the Rest to absorb: refused in words, the field keeps its last good figure.
  const first = await openPart(page, 1);
  await first.getByLabel('Amount', { exact: true }).fill('200000');
  await expect(first.getByRole('alert')).toContainText('Over by');
  await expect(first.getByRole('alert')).toContainText('30.000');
  await expect(first.getByLabel('Amount', { exact: true })).toHaveValue('150.000');
  await donePart(page);
  await expect(parts.nth(2)).toContainText('20.000');

  await split.getByRole('button', { name: 'Close' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // The three entries: the month counts the whole 250.000, Groceries and Household (150.000 and 80.000) under Household,
  // Restaurants (20.000) under Food and beverage, and the receipt names all three categories.
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText('Rp 250.000');
  await page.getByTestId('see-categories').click();
  await expect(page.getByTestId('report-row').filter({ hasText: 'Household' })).toContainText('230.000');
  await expect(page.getByTestId('report-row').filter({ hasText: 'Food and beverage' })).toContainText('20.000');
  await page.goto('/transactions');
  await page.getByTestId('transaction-row').filter({ hasText: 'Pasar Baru' }).first().click();
  await expect(page.getByTestId('hero-amount')).toContainText('250.000');
  await expect(page.getByText('Groceries · Household · Restaurants')).toBeVisible();
});
