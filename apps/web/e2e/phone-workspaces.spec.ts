import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, addTransaction, saveButton, chooseTo } from './add-transaction';
import { openWorkspacePage, workspaceLine } from './workspace-page';

/**
 * On a phone the Cashflow corner is the open workspace itself: its dot, named for it, one tap from the switcher.
 * The switcher only switches; making and joining a workspace are on the Account page.
 */
test('the Cashflow corner is the workspace, and opens the switcher', async ({ page }) => {
  await page.goto('/transactions');
  const corner = page.getByRole('button', { name: /^Workspace, / });
  await expect(corner).toHaveAccessibleName('Workspace, Personal');
  expect((await corner.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await corner.click();
  const switcher = page.getByTestId('workspace-menu');
  await expect(switcher).toBeVisible();
  await expect(switcher.getByTestId('workspace-choice')).toHaveCount(1);
  await expect(switcher.getByRole('menuitemradio', { name: 'Personal' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(switcher).toHaveCount(0);
});

test('choosing another workspace in the switcher switches, and the corner shows its name', async ({ page }) => {
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/transactions');

  await expect(page.getByRole('button', { name: /^Workspace, Business/ })).toBeVisible();
  await page.getByRole('button', { name: /^Workspace, / }).click();
  await page.getByTestId('workspace-menu').getByTestId('workspace-choice').filter({ hasText: 'Personal' }).click();
  await expect(page.getByTestId('workspace-menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Workspace, Personal/ })).toBeVisible();
});

/**
 * A workspace started empty keeps its own categories from the first day: none of Personal's are there to pick, and
 * the picker fills as they are added. Only the handful the app posts into by itself — loan interest, a realised
 * gain — are made with it, so that a repayment recorded here is recorded here.
 */
test('a workspace is made from the Account page and starts with none of the other’s categories', async ({ page }) => {
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();

  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  // There is one Personal already, so the tile for it is refused rather than hidden: the reason is worth reading.
  await expect(sheet.getByRole('button', { name: 'Personal' })).toBeDisabled();
  await expect(sheet.getByLabel('Starts with')).toHaveValue('');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/transactions');

  await expect(page.getByRole('button', { name: /^Workspace, Business/ })).toBeVisible();

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

/** A workspace is renamed from its own page, through the Name row's small sheet; Budget and Currency sit beside it. */
test('a workspace page renames through the Name sheet, toggles Budget and opens the Currency picker', async ({ page }) => {
  await openWorkspacePage(page, 'Personal');
  await page.getByTestId('ws-name-row').click();
  const sheet = page.getByRole('dialog', { name: 'Name' });
  const save = sheet.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await sheet.getByLabel('Name', { exact: true }).fill('');
  await expect(save).toBeDisabled();
  await sheet.getByLabel('Name', { exact: true }).fill('Home');
  await save.click();
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  const budget = page.getByLabel('Budget', { exact: true });
  const was = await budget.isChecked();
  await budget.click({ force: true });
  await expect(budget).toBeChecked({ checked: !was });

  await page.getByTestId('ws-currency-row').click();
  const currencies = page.getByRole('dialog', { name: 'Currency' });
  await expect(currencies.getByRole('button', { name: /^IDR / }).first()).toBeVisible();
  await currencies.getByRole('button', { name: /^USD / }).first().click();
  await expect(currencies).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change currency' })).toBeVisible();

  await page.goto('/account');
  await expect(workspaceLine(page, 'Home')).toBeVisible();
});

/** One account of each kind, so there is somewhere to move money from and somewhere for it to land. */
async function addAccount(page: Page, name: string, type: string, balance: string) {
  await openAccount(page, { subtype: type, name, balance });
}

/**
 * Moving your own money between your own accounts is not spending, so it counts in nobody's figure — but it is
 * filed in the workspace it was recorded in and listed there only, like any other transaction. The account it moved
 * money out of is the owner's, so its own history still holds it whichever workspace is open.
 */
test('a transfer is filed in the workspace it was recorded in, listed there only, and counted in none', async ({ page }) => {
  await page.goto('/wallet');
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

  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/transactions');
  await expect(page.getByRole('button', { name: /^Workspace, Business/ })).toBeVisible();

  // Business: not its transfer, so not on its list, and nothing counted either way.
  await expect(page.getByText('Top up')).toHaveCount(0);
  await expect(page.getByTestId('spending-report')).toContainText('Nothing recorded for');
});

/** Opens the workspace switcher from ⋯ and picks one. */
async function switchTo(page: Page, name: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Workspace, / }).click();
  await page.getByTestId('workspace-menu').getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(page.getByTestId('workspace-menu')).toHaveCount(0);
}

const listRow = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

test('a saved purchase moves to another workspace from its Edit screen, and several from Select', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
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

  await addTransaction(page, { description: 'Supplier dinner', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '640000' });
  await addTransaction(page, { description: 'Client lunch', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '210000' });

  // One, from its Edit screen: the Workspace row moves it, its category becomes Business's Restaurants.
  await listRow(page, 'Supplier dinner').getByRole('button', { name: /^Restaurants/ }).click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  const workspace = edit.getByRole('button', { name: 'Workspace for this transaction' });
  await expect(workspace).toBeEnabled();
  await workspace.click();
  await page.getByRole('dialog', { name: 'Move to workspace' }).getByRole('button', { name: 'Business' }).click();
  await expect(workspace).toContainText('Business');
  await expect(workspace).toContainText('Moving to');
  await expect(edit.getByRole('button', { name: 'Category' })).toContainText('Restaurants');
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);
  await page.goto('/transactions');
  await expect(listRow(page, 'Supplier dinner')).toHaveCount(0);

  // Several, from Select.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Client lunch' }).click();
  const bar = page.getByRole('toolbar', { name: 'Selected transactions' });
  await bar.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Move to workspace' }).click();
  // The bar stands down while the sheet is up, so nothing sits over its rows.
  await expect(bar).toHaveCount(0);
  const business = page.getByRole('dialog', { name: 'Move to workspace' }).getByRole('button', { name: 'Business' });
  await expect(business).toBeInViewport();
  await business.click();
  await expect(bar).toHaveCount(0);
  await expect(listRow(page, 'Client lunch')).toHaveCount(0);

  await switchTo(page, 'Business');
  await expect(listRow(page, 'Supplier dinner')).toContainText('640.000');
  await expect(listRow(page, 'Client lunch')).toContainText('210.000');
});

test('a purchase moved to another workspace with No category lands there, under that workspace\'s Uncategorised', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Business');
  await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await switchTo(page, 'Personal');
  await addTransaction(page, { description: 'Ornek printing', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '93000' });

  await listRow(page, 'Ornek printing').getByRole('button', { name: /^Restaurants/ }).click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  await edit.getByRole('button', { name: 'Workspace for this transaction' }).click();
  await page.getByRole('dialog', { name: 'Move to workspace' }).getByRole('button', { name: 'Business' }).click();
  await edit.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByTestId('category-none').click();
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);
  await page.goto('/transactions');
  await expect(listRow(page, 'Ornek printing')).toHaveCount(0);

  await switchTo(page, 'Business');
  await expect(listRow(page, 'Ornek printing')).toContainText('Uncategorised');
  await expect(listRow(page, 'Ornek printing')).toContainText('93.000');
});
