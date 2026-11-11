import { expect, test } from '@playwright/test';
import { currencyRow, setCurrency } from './currency-field';
import { openWorkspacePage, openWorkspaceSharePage, renameWorkspace } from './workspace-page';

test.describe.configure({ timeout: 120_000 });

test('by thumb: Share is one page — a name, a button, then the invite with Copy, and the member on a page of its own', async ({ page }) => {
  await page.goto('/account');
  await openWorkspacePage(page, 'Personal');
  await renameWorkspace(page, 'Home');

  // The workspace page holds one row, Off; it opens a page titled Share, with no pop-up and no form on the workspace page.
  const row = page.getByTestId('ws-share-row');
  await expect(row).toContainText('Off');
  await row.tap();
  await expect(page).toHaveURL(/\/account\/workspaces\/[^/]+\/share$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // One field and one button, disabled until a name is typed; the long text is behind the ⓘ, not under the row.
  const button = page.getByTestId('share-button');
  await expect(button).toBeDisabled();
  await expect(page.getByText('Everything is encrypted on this device')).toHaveCount(0);
  await page.getByRole('button', { name: 'About Name' }).tap();
  await expect(page.getByText('Everything is encrypted on this device')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await page.getByTestId('share-name').fill('Ana');
  await expect(button).toBeEnabled();
  await button.tap();

  // The invite is there as soon as it is made, with Copy; nobody has joined, so the members say so.
  await expect(page.getByTestId('invite-code')).toHaveText(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/, { timeout: 60_000 });
  await expect(page.getByTestId('share-copy')).toBeVisible();
  await expect(page.getByTestId('sharing-status')).toContainText('Up to date');
  await expect(page.getByTestId('sharing-member')).toHaveCount(1);
  await expect(page.getByTestId('sharing-member')).toContainText('Owner');
  await expect(page.getByTestId('sharing-waiting')).toContainText('Invite open');
  await expect(page.getByRole('button', { name: 'Leave', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The member's own page: the role, this device, and an owner's actions on themselves.
  await page.getByTestId('sharing-member').tap();
  const member = page.getByTestId('member-page');
  await expect(member).toContainText('Owner');
  await expect(member.getByTestId('sharing-device')).toContainText('This device');
  await expect(member.getByRole('button', { name: 'Link a device', exact: true })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Invite someone', exact: true })).toBeVisible();
  await page.goBack();

  // The invite is still there on coming back; and the workspace page now says On.
  await expect(page.getByTestId('invite-code')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('ws-share-row')).toContainText('On');
});

test('by thumb: a workspace in another currency says why it cannot be shared, in one line', async ({ page }) => {
  await page.goto('/account');
  await page.getByTestId('add-workspace').tap();
  await page.getByTestId('new-workspace').tap();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Singapore');
  await setCurrency(currencyRow(sheet, 'Reads in'), 'SGD');
  await sheet.getByRole('button', { name: 'Create workspace' }).tap();
  await expect(sheet).toHaveCount(0);

  await openWorkspaceSharePage(page, 'Singapore');
  await expect(page.getByTestId('share-refusal')).toHaveText("This workspace keeps its money in SGD; this app's own accounts are kept in IDR. Sharing across currencies isn't supported yet.");
  await expect(page.getByTestId('share-button')).toHaveCount(0);
  await expect(page.getByTestId('share-name')).toHaveCount(0);
});
