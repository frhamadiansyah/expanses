import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openCard } from './accounts';
import { addForm, choosePayment, saveButton } from './add-transaction';
import { openSplit } from './split-row';

/*
 * One card purchase split across workspaces, a part of it left out of reports (0090). Invented figures: Rp 4.500.000 at
 * Toko Sinar Jaya on BCA Visa. Each workspace's Cashflow counts its own part only; a part Not counted is in none; the
 * card owes the whole charge either way.
 */

/** Makes Business from ⋯, a copy of Personal's categories, and comes back to Personal. */
async function withBusiness(page: Page) {
  await openCard(page, { name: 'BCA Visa', statementDay: '31', dueDay: '15' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await switchTo(page, 'Personal');
}

/** Opens the workspace switcher from ⋯ and picks one, landing on its Cashflow. */
async function switchTo(page: Page, name: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toHaveCount(0);
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
  await split.getByRole('button', { name: '+ Split' }).click();
  return { form, split };
}

test('a part Not counted is in no workspace’s Cashflow, while the card owes the whole charge', async ({ page }) => {
  await withBusiness(page);
  const { form, split } = await startSplit(page);
  await split.getByLabel('Split 1 amount').fill('500000');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Food and beverage › Restaurants' });
  await split.getByLabel('Split 2 amount').fill('3000000');
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 3 category').selectOption({ label: 'Not counted' });
  await split.getByLabel('Split 3 amount').fill('1000000');
  const parts = split.getByTestId('split-row');
  // A workspace's part has its own switch; the part in no workspace has none, and says where it stands instead.
  await expect(parts.nth(0).getByRole('switch', { name: 'Exclude from report' })).toBeVisible();
  await expect(parts.nth(1).getByRole('switch', { name: 'Exclude from report' })).toBeVisible();
  await expect(parts.nth(2).getByRole('switch', { name: 'Exclude from report' })).toHaveCount(0);
  await expect(parts.nth(2)).toContainText('In no workspace and no report');
  await expect(split.getByText('Total Rp 4.500.000')).toBeVisible();
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
  await split.getByLabel('Split 1 amount').fill('500000');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Food and beverage › Restaurants' });
  await split.getByLabel('Split 2 amount').fill('4000000');
  const business = split.getByTestId('split-row').nth(1).getByRole('switch', { name: 'Exclude from report' });
  await business.click();
  await expect(business).toHaveAttribute('aria-checked', 'true');
  await expect(split.getByTestId('split-row').nth(0).getByRole('switch', { name: 'Exclude from report' })).toHaveAttribute('aria-checked', 'false');
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
