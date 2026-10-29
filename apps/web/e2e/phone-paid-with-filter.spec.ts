import { expect, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * The list's Paid with filter on a phone: a sheet with a search at its top, every account led by its digits with its
 * name beneath, and "All" first. A few digits are enough to find a card — "48" leaves 4821 alone. Once something is
 * picked the icon that opened the sheet goes dark with a dot, and there is no pill with a ✕ under the chart: the
 * filter comes off from the sheet's own All row.
 */
test('Paid with is a sheet with a search; "48" leaves 4821, the pick marks the icon with a dot, and All clears it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openCard(page, { name: 'Mandiri Signature', owed: '0', last4: '4821' });
  await openCard(page, { name: 'Visa Platinum', owed: '0', last4: '7310' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '500000' });
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'Mandiri Signature', category: 'Groceries', amount: '38000' });
  const rows = page.getByTestId('transaction-row');
  await expect(rows).toHaveCount(2);

  const icon = page.getByRole('button', { name: 'Sort and filter' });
  const openSheet = async () => {
    await icon.click();
    await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  };
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
  await openSheet();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await expect(sheet.getByRole('button', { name: 'All', exact: true })).toBeVisible();
  // Each card is named by its name and its digits, the digits leading on screen.
  const mandiri = sheet.getByRole('button', { name: 'Mandiri Signature ···· 4821' });
  await expect(mandiri).toBeVisible();
  // A card nothing was paid with is not offered: the filter lists only what the list can show.
  await expect(sheet.getByRole('button', { name: 'Visa Platinum ···· 7310' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  // Two digits narrow the sheet to the one card they belong to; All steps aside while something is typed.
  await sheet.getByLabel('Find an account').fill('48');
  await expect(sheet.getByRole('button', { name: /····/ })).toHaveCount(1);
  await expect(mandiri).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'BCA Tahapan', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'All', exact: true })).toHaveCount(0);

  // Picked: the list is the card's alone, the icon says so with its dot, and no pill offers a ✕.
  await mandiri.click();
  await expect(sheet).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Kopi Kenangan');
  await expect(page.getByTestId('filter-on')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear paid with' })).toHaveCount(0);

  // All takes the filter off again, dot and all.
  await openSheet();
  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
});
