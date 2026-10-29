import { expect, test } from '@playwright/test';
import { workspaceLine } from './workspace-page';

/**
 * The Account page and a workspace's own page, on a phone: a main page with no way back, one line per workspace
 * (the body switches to it, the › opens it), the type chosen from a sheet, and an archived workspace listed in the
 * same group, muted, until it is restored from its page.
 */
test('Account: switch by the row, open a workspace by its ›, retype it, archive it and restore it', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Main' });
  await bar.getByRole('link', { name: 'Account' }).click();

  // A main page: no ‹, and no subtitle line under the title.
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Account' })).toHaveCount(0);
  await expect(page.locator('main header')).toHaveCount(0);
  await expect(page.getByText(/^Open:/)).toHaveCount(0);

  // A second workspace, made from the sheet this page opens.
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Warung');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByTestId('account-workspace')).toHaveCount(2);

  // Tapping the row switches and stays on the page: the ✓ moves.
  const personal = workspaceLine(page, 'Personal');
  const warung = workspaceLine(page, 'Warung');
  await personal.getByTestId('workspace-switch').click();
  await expect(personal.getByLabel('Open', { exact: true })).toBeVisible();
  await expect(warung.getByLabel('Open', { exact: true })).toHaveCount(0);
  await warung.getByTestId('workspace-switch').click();
  await expect(warung.getByLabel('Open', { exact: true })).toBeVisible();
  await expect(personal.getByLabel('Open', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/account$/);
  // One line each: the name and nothing under it.
  await expect(warung).not.toContainText('IDR');

  // The › opens the workspace's own page, where the type is changed through a sheet.
  await warung.getByTestId('workspace-open').click();
  await expect(page.getByRole('heading', { name: 'Warung' })).toBeVisible();
  const type = page.getByRole('button', { name: /^Type/ });
  await type.click();
  const types = page.getByRole('dialog', { name: 'Type' });
  await expect(types.getByTestId('type-business')).toBeVisible();
  await types.getByTestId('type-family').click();
  await expect(types).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Type/ })).toContainText('Family');

  // Archive asks twice, lands back on the page, and the workspace is listed in the same group, muted.
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to archive' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('account-workspace')).toHaveCount(1);
  const archived = page.getByTestId('archived-workspace');
  await expect(archived).toHaveCount(1);
  await expect(archived).toContainText('Warung');
  await expect(archived).toContainText('Archived');

  // Opening it shows it as archived with Restore, and Restore brings it back into the list.
  await archived.click();
  await expect(page.getByRole('heading', { name: 'Warung' })).toBeVisible();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await page.getByTestId('restore-workspace').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('archived-workspace')).toHaveCount(0);
  await expect(page.getByTestId('account-workspace')).toHaveCount(2);
  // The type it was given is still its own.
  await workspaceLine(page, 'Warung').getByTestId('workspace-open').click();
  await expect(page.getByRole('button', { name: /^Type/ })).toContainText('Family');
});
