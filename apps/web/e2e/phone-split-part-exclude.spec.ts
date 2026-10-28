import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openCard } from './accounts';
import { addForm, choosePayment, saveButton } from './add-transaction';
import { addPart, donePart, fillPart, openPart, openSplit, partExcluded, pickPartCategory } from './split-row';

/*
 * One card purchase split across workspaces, a part of it left out of reports (0090). Invented figures: Rp 4.500.000 at
 * Toko Sinar Jaya on BCA Visa. Each workspace's Cashflow counts its own part only; a part Not counted is in none; the
 * card owes the whole charge either way.
 */

/** Makes Business from ⋯, a copy of Personal's categories, and comes back to Personal. */
async function withBusiness(page: Page) {
  await openCard(page, { name: 'BCA Visa', statementDay: '31', dueDay: '15' });
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/transactions');
  await switchTo(page, 'Personal');
}

/** Opens the workspace switcher from ⋯ and picks one, landing on its Cashflow. */
async function switchTo(page: Page, name: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Workspace, / }).click();
  await page.getByTestId('workspace-menu').getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(page.getByTestId('workspace-menu')).toHaveCount(0);
  await page.goto('/transactions');
}

const row = (page: Page) => page.getByTestId('transaction-row').filter({ hasText: 'Toko Sinar Jaya' });
const periodTotal = (page: Page) => page.getByTestId('spending-report').getByTestId('period-total');

/** Starts the purchase on the card, Groceries chosen, and opens its Split sheet. */
async function startSplit(page: Page) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Visa');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Toko Sinar Jaya');
  await form.getByRole('button', { name: 'Add more details' }).click();
  await openSplit(page);
  const split = page.getByRole('dialog', { name: 'Split' });
  await addPart(page);
  return { form, split };
}

test('a part Not counted is in no workspace’s Cashflow, while the card owes the whole charge', async ({ page }) => {
  await withBusiness(page);
  const { form, split } = await startSplit(page);
  await fillPart(page, 1, '500000');
  await pickPartCategory(page, 2, 'Restaurants', 'Business');
  await fillPart(page, 2, '3000000');
  await addPart(page);
  await pickPartCategory(page, 3, '', 'No workspace');
  await fillPart(page, 3, '1000000');
  const parts = split.getByTestId('split-row');
  // A workspace's part has its own switch; the part in no workspace has none, and says where it stands instead.
  await partExcluded(page, 1);
  await partExcluded(page, 2);
  await expect(parts.nth(2)).toContainText('Not counted');
  const notCounted = await openPart(page, 3);
  await expect(notCounted.getByRole('checkbox', { name: 'Exclude from report' })).toHaveCount(0);
  await expect(notCounted).toContainText('In no workspace and no report');
  await donePart(page);
  await expect(split.getByTestId('split-total')).toContainText('4.500.000');
  await split.getByRole('button', { name: 'Close' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Personal counts its Rp 500.000; the row is its part, marked as split.
  await page.goto('/transactions');
  await expect(row(page)).toContainText('500.000');
  await expect(row(page)).toContainText('⑂ split');
  await expect(periodTotal(page)).toHaveText('Rp 500.000');

  // The receipt: the whole charge, each part with its workspace, and the part in none.
  await row(page).getByRole('button', { name: /^Groceries/ }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('4.500.000');
  await expect(page.getByText('Charged on BCA Visa')).toBeVisible();
  const receiptParts = page.getByTestId('split-part');
  await expect(receiptParts).toHaveCount(3);
  await expect(receiptParts.filter({ hasText: 'Not counted' })).toContainText('1.000.000');
  await expect(receiptParts.filter({ hasText: 'Not counted' })).toContainText('In no workspace and no report');
  await expect(receiptParts.filter({ hasText: 'Restaurants' })).toContainText('Business');

  // Business counts its Rp 3.000.000, and nothing of the part Not counted.
  await switchTo(page, 'Business');
  await expect(row(page)).toContainText('3.000.000');
  await expect(periodTotal(page)).toHaveText('Rp 3.000.000');

  // The card owes all of it.
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Visa', '4.500.000');
});

test('a part excluded from its workspace’s report leaves that Cashflow alone, the other part and the card untouched', async ({ page }) => {
  await withBusiness(page);
  const { form, split } = await startSplit(page);
  await fillPart(page, 1, '500000');
  await pickPartCategory(page, 2, 'Restaurants', 'Business');
  await fillPart(page, 2, '4000000');
  expect(await partExcluded(page, 2, true)).toBe(true);
  expect(await partExcluded(page, 1)).toBe(false);
  await split.getByRole('button', { name: 'Close' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Personal: its part counts.
  await page.goto('/transactions');
  await expect(periodTotal(page)).toHaveText('Rp 500.000');
  await expect(row(page)).not.toContainText('Excluded');

  // Business: listed, marked excluded, out of the total.
  await switchTo(page, 'Business');
  await expect(row(page)).toContainText('4.000.000');
  await expect(row(page)).toContainText('Excluded');
  await expect(periodTotal(page)).toHaveText('Rp 0');

  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Visa', '4.500.000');
});

test('two lines of one workspace switch on their own: Exclude on Groceries leaves Restaurants counted', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa', statementDay: '31', dueDay: '15' });
  await page.goto('/transactions');
  const { form, split } = await startSplit(page);
  await fillPart(page, 1, '300000');
  await pickPartCategory(page, 2, 'Restaurants');
  await fillPart(page, 2, '200000');

  const states = async () => [await partExcluded(page, 1), await partExcluded(page, 2)];
  await partExcluded(page, 1, true);
  expect(await states()).toEqual([true, false]);
  // The other way round, then back: each switch moves alone.
  await partExcluded(page, 2, true);
  await partExcluded(page, 1, false);
  expect(await states()).toEqual([false, true]);
  await partExcluded(page, 2, false);
  await partExcluded(page, 1, true);
  expect(await states()).toEqual([true, false]);
  await split.getByRole('button', { name: 'Close' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Only Restaurants counts; the row is not marked excluded, since part of it counts.
  await page.goto('/transactions');
  await expect(periodTotal(page)).toHaveText('Rp 200.000');
  await expect(row(page)).not.toContainText('Excluded');
  // The row is the part that counts: Restaurants, its Rp 200.000, and the left-out Rp 300.000 under the amount.
  await expect(row(page)).toContainText('Restaurants');
  await expect(row(page)).toContainText('200.000');
  await expect(row(page)).not.toContainText('500.000');
  await expect(row(page).getByTestId('amount-extra')).toHaveText('⊘ Rp 300.000');
  await expect(row(page).getByLabel(/^Excluded from report, Rp.300\.000$/)).toBeVisible();
  // The day's total is the sum of the rows.
  await expect(page.getByTestId('day-total').first()).toContainText('200.000');

  // The receipt says which line is out; the card owes the whole charge.
  await row(page).getByRole('button', { name: /^Restaurants/ }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('500.000');
  const receiptParts = page.getByTestId('split-part');
  await expect(receiptParts).toHaveCount(2);
  await expect(receiptParts.filter({ hasText: 'Groceries' })).toHaveAttribute('data-excluded', 'true');
  await expect(receiptParts.filter({ hasText: 'Restaurants' })).not.toHaveAttribute('data-excluded', 'true');

  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Visa', '500.000');
});
