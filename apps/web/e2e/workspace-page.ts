import { expect, type Page } from '@playwright/test';

/** The Account page's line for an open workspace. */
export const workspaceLine = (page: Page, name: string) => page.getByTestId('account-workspace').filter({ hasText: name });

/** Account → the workspace's › → its own page, where it is renamed, retyped, shared and archived. */
export async function openWorkspacePage(page: Page, name: string) {
  await page.goto('/account');
  await workspaceLine(page, name).getByTestId('workspace-open').click();
  await expect(page.getByRole('button', { name: 'Save name', exact: true })).toBeVisible();
}
