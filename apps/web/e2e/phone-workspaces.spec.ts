import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, saveButton, chooseTo } from './add-transaction';

/**
 * On a phone the ⋯ menu is the only room left for anything that is not the list itself, so the workspace sits
 * at the top of it: above the three filters, because it changes the whole app where they narrow one month.
 */
test('the workspace is the first thing under ⋯, and opens the switcher', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  const menu = page.getByTestId('filters-menu');
  await expect(menu.getByTestId('workspace-row')).toBeVisible();
  // It comes before the three filters, because it changes the app rather than narrowing the list.
  await expect(menu.getByRole('menuitem').first()).toHaveAttribute('data-testid', 'workspace-row');
  await expect(menu.getByTestId('workspace-row')).toContainText('Personal');
  await menu.getByTestId('workspace-row').click();
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toBeVisible();
  await expect(page.getByTestId('workspace-choice')).toHaveCount(1);
});

/**
 * A workspace started empty keeps its own categories from the first day: none of Personal's are there to pick, and
 * the picker fills as they are added. Only the handful the app posts into by itself — loan interest, a realised
 * gain — are made with it, so that a repayment recorded here is recorded here.
 */
test('a workspace is made from ⋯ and starts with none of the other’s categories', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'New workspace' }).click();

  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  // There is one Personal already, so the tile for it is refused rather than hidden: the reason is worth reading.
  await expect(sheet.getByRole('button', { name: 'Personal' })).toBeDisabled();
  await expect(sheet.getByLabel('Starts with')).toHaveValue('');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByTestId('filters-menu').getByTestId('workspace-row')).toContainText('Business');
  await page.keyboard.press('Escape');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add a transaction' }).click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Category' }).click();
  const picker = page.getByRole('dialog', { name: 'Select category' });
  // Personal's own spending categories are Personal's: none of them is on offer here.
  await expect(picker.getByRole('button', { name: 'Restaurants', exact: true })).toHaveCount(0);
  // Interest is one the app posts into by itself, so Business made its own — and exactly one. Both workspaces
  // carry a `miscellaneous.interest`, so a picker that stopped narrowing to the open workspace would offer two
  // buttons reading "Interest" and file a repayment in whichever the user happened to hit.
  await expect(picker.getByRole('button', { name: 'Interest', exact: true })).toHaveCount(1);

  await picker.getByRole('radio', { name: 'Income', exact: true }).click();
  // The same on the income side: Personal's Salary is not here, and the realised gain the app posts into is,
  // once. The other workspace's copy of it would make two.
  await expect(picker.getByRole('button', { name: 'Salary', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Realized Gains', exact: true })).toHaveCount(1);
});

/** One account of each kind, so there is somewhere to move money from and somewhere for it to land. */
async function addAccount(page: Page, name: string, type: string, balance: string) {
  await openAccount(page, { subtype: type, name, balance });
}

/**
 * Moving your own money between your own accounts is not spending, so it is filed in no workspace — and a row
 * filed nowhere has to be visible from everywhere, or the account it moved money out of stops adding up from
 * inside a workspace. It counts in nobody's figure, which is why the chart reads the same on both sides.
 */
test('a transfer is filed in no workspace, so every workspace shows it and none counts it', async ({ page }) => {
  await page.goto('/accounts');
  await addAccount(page, 'BCA Tahapan', 'bank', '20000000');
  await addAccount(page, 'Jenius', 'savings', '0');

  await page.goto('/transactions');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add a transaction' }).click();
  const form = addForm(page);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await chooseTo(form, 'Jenius (IDR)');
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const digit of '500000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByLabel('Note').fill('Top up');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Personal: the transfer is on the list, and the month's chart has nothing to draw.
  await expect(page.getByText('Top up').first()).toBeVisible();
  await expect(page.getByTestId('spending-report')).toContainText('Nothing recorded for');

  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByTestId('filters-menu').getByTestId('workspace-row')).toContainText('Business');
  await page.keyboard.press('Escape');

  // Business: the same transfer, still there, and still counted in nothing.
  await expect(page.getByText('Top up').first()).toBeVisible();
  await expect(page.getByTestId('spending-report')).toContainText('Nothing recorded for');
});
