import { expect, type Page, test } from '@playwright/test';

/**
 * An account is yours, not a workspace's, so its history holds every workspace and each row says which one it
 * belongs to — unless there is only one workspace, when the badge would say the same word on every row.
 */
test('an account’s history opens from Accounts, and badges nothing while there is one workspace', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Supplier dinner');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByLabel('Amount', { exact: true }).fill('640000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Supplier dinner')).toBeVisible();

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'BCA Tahapan', exact: true }).click();
  await expect(page.locator('li', { hasText: 'Supplier dinner' }).first()).toContainText('640.000');
  // One workspace, so no row names it: a badge every row carried would say nothing at all.
  await expect(page.getByTestId('workspace-badge')).toHaveCount(0);
});

/**
 * A wide screen keeps the switcher in the sidebar, where it is on every screen — the phone reaches it only from
 * Cashflow's ⋯, so the desktop is the stronger of the two, which is the rule.
 */
test('the sidebar names the open workspace and opens the switcher', async ({ page }) => {
  await page.goto('/');
  const switcher = page.getByRole('button', { name: 'Workspace', exact: true });
  await expect(switcher).toContainText('Personal');
  await expect(switcher).toContainText('IDR');
  await switcher.click();
  const sheet = page.getByRole('dialog', { name: 'Workspaces' });
  await expect(sheet).toBeVisible();
  // One workspace, and it is the open one: a tick beside it, and nothing else to choose.
  const rows = sheet.getByTestId('workspace-choice');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Personal');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(rows.first().getByLabel('Open')).toBeVisible();
  // It is reachable from a screen that is not Cashflow, which is the point of it living in the sidebar.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.goto('/accounts');
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
});

/** A bank account to pay from, since every flow below needs somewhere for the money to come out of. */
async function addBank(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(description)).toBeVisible();
}

/** Makes a workspace through the sidebar switcher and lands in it, as the sheet does on its own. */
async function newWorkspace(page: Page, name: string, startsWith: string) {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Starts with').selectOption({ label: startsWith });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

/**
 * A workspace made from another's categories starts with the tree and none of the spending: the two share a shape,
 * never a figure. Switching back finds the spending exactly where it was left.
 */
test('a new workspace copies the categories, opens empty, and leaves the other alone', async ({ page }) => {
  await addBank(page);
  await spend(page, 'Supplier dinner', '640000');

  await newWorkspace(page, 'Business', 'Copy from Personal');

  await page.goto('/transactions');
  await expect(page.getByText('Supplier dinner')).toHaveCount(0);
  // The tree came with it, so there is somewhere to file a business dinner from the first day.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Restaurants' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Back in Personal, the dinner is where it was: a new workspace took nothing away.
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Personal' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Personal');
  await expect(page.getByText('Supplier dinner')).toBeVisible();
});

/**
 * An account is yours, so its history holds every workspace — badged, and read-only for the rows that are not the
 * open workspace's, since saving one here would re-file it into the workspace being looked from.
 */
test('an account’s history holds every workspace, each row saying which', async ({ page }) => {
  await addBank(page);
  await spend(page, 'Supplier dinner', '640000');
  await newWorkspace(page, 'Business', 'Copy from Personal');
  await spend(page, 'Client lunch', '320000');

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'BCA Tahapan', exact: true }).click();
  await expect(page.getByTestId('workspace-badge').filter({ hasText: 'Business' })).toBeVisible();
  await expect(page.getByTestId('workspace-badge').filter({ hasText: 'Personal' })).toBeVisible();

  // Personal's row cannot be edited from Business: pressing it says so, and offers the way there.
  await page.locator('li', { hasText: 'Supplier dinner' }).first().click();
  await expect(page.getByTestId('other-workspace-note')).toContainText('Filed in Personal — open that workspace to edit it.');
  await page.getByRole('button', { name: 'Open Personal' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Personal');
});
