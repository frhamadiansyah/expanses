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

/** The workspace page's Share row → the Share page. */
export async function openSharePage(page: Page) {
  await page.getByTestId('ws-share-row').click();
  await expect(page).toHaveURL(/\/account\/workspaces\/[^/]+\/share$/);
}

/** Account → the workspace → Share: its Share page. */
export async function openWorkspaceSharePage(page: Page, name: string) {
  await openWorkspacePage(page, name);
  await openSharePage(page);
}

/** On the Share page of a workspace not shared yet: the name, Share, and the invite code once the history has gone up. */
export async function shareWorkspace(page: Page, name: string): Promise<string> {
  await page.getByTestId('share-name').fill(name);
  await page.getByTestId('share-button').click();
  return (await page.getByTestId('invite-code').textContent({ timeout: 60_000 }))!.trim();
}

/** On a Share page: a member's row → their page. */
export async function openMemberPage(page: Page, member: string | RegExp) {
  await page.getByTestId('sharing-member').filter({ hasText: member }).click();
  await expect(page.getByTestId('member-page')).toBeVisible();
}

/** On a Share page: the Net worth row → the Net worth page. */
export async function openNetWorthPage(page: Page) {
  await page.getByTestId('net-worth-row').click();
  await expect(page).toHaveURL(/\/share\/net-worth$/);
}
