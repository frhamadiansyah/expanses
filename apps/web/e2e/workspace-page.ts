import { expect, type Page } from '@playwright/test';

/** The Account page's line for an open workspace. */
export const workspaceLine = (page: Page, name: string) => page.getByTestId('account-workspace').filter({ hasText: name });

/** Account → the workspace's › → its own page, where it is renamed, retyped, shared and archived. */
export async function openWorkspacePage(page: Page, name: string) {
  await page.goto('/account');
  await workspaceLine(page, name).getByTestId('workspace-open').click();
  await expect(page.getByTestId('ws-name-row')).toBeVisible();
}

/** The Name row's small sheet: type the new name and Save. */
export async function renameWorkspace(page: Page, name: string) {
  await page.getByTestId('ws-name-row').click();
  const sheet = page.getByRole('dialog', { name: 'Name' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);
}
