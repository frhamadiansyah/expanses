import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { waitForSafetyCopy } from './recovery-fixture';
import { openSharePage, openWorkspacePage, putOffShareList, renameWorkspace, shareWorkspace, workspaceLine } from './workspace-page';

/*
 * Mac Settings and Tools (mockup 2026-11-18, step 13), on a wide screen with an invented household: Settings as System
 * Settings draws it (sections, Search, the section remembered and named by ?section=, ⌘, from the shell), each section
 * reading what the phone's pages read; Tools as a page of tiles. Backup's buttons reach the Backup page's own flows —
 * every restore here is called off at its confirm (the full restores run in backup.spec, photos.spec and the rest, on
 * invented data only).
 */

test.beforeEach(async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

const sections = (page: Page) => page.getByRole('navigation', { name: 'Settings sections' });
const section = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name.replace(/[&]/g, '\\$&')}`) });

test('the sidebar’s Settings opens Settings, and each section shows its own rows', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '2500000' });
  await page.locator('aside').getByRole('link', { name: 'App settings', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
  await expect(sections(page).getByRole('button')).toHaveText(['Workspaces & sharing', 'Devices', 'Backup', 'Defaults', 'Categories', 'Activity', 'About']);
  // The places the sidebar holds are not repeated in Settings.
  for (const place of ['Budget', 'Recurring', 'Events', 'Goals', 'Debt-free plan', 'Review', 'Calculators', 'Tax report', 'Import', 'Which card?']) {
    await expect(page.getByTestId('settings-page').getByRole('link', { name: place, exact: true })).toHaveCount(0);
  }

  // Workspaces & sharing first: the open workspace, ＋ Add workspace, and the way to share it.
  await expect(section(page, 'Workspaces & sharing')).toHaveAttribute('aria-current', 'page');
  const personal = page.getByTestId('account-workspace').filter({ hasText: 'Personal' });
  await expect(personal).toContainText('IDR · on this device');
  await expect(personal.getByTestId('workspace-switch')).toHaveText('open now ✓');
  await expect(page.getByTestId('add-workspace')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Share…' })).toBeVisible();

  // Devices: this device the only copy, Link to another device offered beside Link another device.
  await section(page, 'Devices').click();
  await expect(page).toHaveURL(/\?section=devices$/);
  await expect(page.getByTestId('device-this')).toContainText('this device · only copy');
  await expect(page.getByTestId('link-another')).toHaveText('Link…');
  await expect(page.getByTestId('link-to-another')).toHaveText('Link…');

  await section(page, 'Backup').click();
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  for (const name of ['Download backup', 'Choose file…', 'Choose…']) await expect(page.getByTestId('settings-backup').getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Safety copies on this device' }) })).toBeVisible();

  // Defaults: Paid with for new spending, saved as it is chosen.
  await section(page, 'Defaults').click();
  const paidWith = page.getByLabel('Paid with for new spending');
  await expect(paidWith.locator('option:checked')).toHaveText('None');
  await paidWith.selectOption({ label: 'Bank Satu' });
  await expect(paidWith).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Paid with for new spending').locator('option:checked')).toHaveText('Bank Satu');

  await section(page, 'Categories').click();
  await expect(page.getByTestId('settings-categories').getByRole('link', { name: /^Expense categories/ })).toContainText(/\d+ categories/);
  await page.getByTestId('settings-categories').getByRole('link', { name: /^Income categories/ }).click();
  await expect(page).toHaveURL(/\/categories\?kind=income$/);
  // The editor is under Settings in the sidebar.
  await expect(page.locator('aside').getByRole('link', { name: 'App settings', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.goto('/account?section=activity');
  await expect(page.getByTestId('settings-activity')).toContainText('Nothing changed yet');

  await section(page, 'About').click();
  await expect(page.getByTestId('about-version')).toHaveText(/\d+\.\d+\.\d+ \(web\)/);
  await expect(page.getByTestId('settings-about')).toContainText(/update \d+/);
});

test('⌘, opens Settings at the section last chosen; ?section= and /backup name one without changing it', async ({ page }) => {
  await page.goto('/account');
  await section(page, 'Backup').click();
  await expect(page).toHaveURL(/\/account\?section=backup$/);

  // The Mac app's cicis › Settings… raises this event; Settings opens from anywhere, where it was left.
  await page.locator('aside').getByRole('link', { name: 'Budget', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cicis:open-settings')));
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await expect(section(page, 'Backup')).toHaveAttribute('aria-current', 'page');

  // A deep link shows its section, and the device's choice stays.
  await page.goto('/account?section=about');
  await expect(page.getByTestId('settings-about')).toBeVisible();
  await page.locator('aside').getByRole('link', { name: 'App settings', exact: true }).click();
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('settings-backup')).toBeVisible({ timeout: 30_000 });

  // The old address of Backup, on a wide screen, is the same section under Settings.
  await page.goto('/account?section=categories');
  await page.goto('/backup');
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await expect(page.locator('aside').getByRole('link', { name: 'App settings', exact: true })).toHaveAttribute('aria-current', 'page');
  // A section that does not exist is the remembered one.
  await page.goto('/account?section=nonsense');
  await expect(page.getByTestId('settings-backup')).toBeVisible();
});

test('Search filters the sections by their names and their rows', async ({ page }) => {
  await page.goto('/account');
  const search = page.getByLabel('Search settings');
  await search.fill('link');
  await expect(sections(page).getByRole('button')).toHaveCount(1);
  await expect(section(page, 'Devices')).toContainText('Link another device · Link to another device');
  await search.press('Enter');
  await expect(page).toHaveURL(/\?section=devices$/);
  await expect(page.getByTestId('settings-devices')).toBeVisible();

  await search.fill('restore');
  await expect(sections(page).getByRole('button')).toHaveText([/^Backup/]);
  await search.fill('PERSONAL');
  await expect(sections(page).getByRole('button')).toHaveText([/^Workspaces & sharing\s*Personal/]);
  await search.fill('zebra');
  await expect(sections(page).getByRole('button')).toHaveCount(0);
  await expect(page.getByText('No setting by that name.')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(sections(page).getByRole('button')).toHaveCount(7);
});

test('Tools: the sidebar’s Tools › opens the tiles, each opens its page, and Find a tool filters them', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '2500000' });
  const tools = page.locator('aside').getByRole('link', { name: 'Tools', exact: true });
  await tools.click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tools', exact: true })).toBeVisible();
  const board = page.getByTestId('tools-page');
  for (const group of ['Calculators', 'Cards', 'Money', 'Tax & data']) await expect(board.getByRole('heading', { name: group, exact: true })).toBeVisible();

  const opens: [string, RegExp][] = [
    ['Emergency fund', /\/calculators\/emergency$/],
    ['Education fund', /\/calculators\/education$/],
    ['Retirement fund', /\/calculators\/retirement$/],
    ['Life cover', /\/calculators\/life-cover$/],
    ['Loan', /\/calculators\/loan$/],
    ['Which card?', /\/recommend$/],
    ['Merchants', /\/cards\/merchants$/],
    ['Lend & borrow', /\/net-worth\/lend-borrow$/],
    ['Split a receipt', /\/transactions\/receipt-split\/start$/],
    ['Tax report', /\/tax-report$/],
    ['Import', /\/import$/],
  ];
  for (const [label, address] of opens) {
    await page.goto('/tools');
    await page.getByTestId('tools-page').getByRole('link', { name: new RegExp(`^${label.replace(/[?&]/g, '\\$&')}`) }).click();
    await expect(page).toHaveURL(address);
  }

  // Statement check asks which account first, as the old Tools menu did; Escape puts the question away.
  await page.goto('/tools');
  await page.getByRole('button', { name: /^Statement check/ }).click();
  const which = page.getByRole('menu', { name: /Statement check/ });
  await expect(which.getByRole('menuitem')).toHaveText(['Bank Satu']);
  await page.keyboard.press('Escape');
  await expect(which).toHaveCount(0);
  await page.getByRole('button', { name: /^Statement check/ }).click();
  await which.getByRole('menuitem', { name: 'Bank Satu' }).click();
  await expect(page).toHaveURL(/\/statement\/list\?account=/);
  await expect(tools).toHaveAttribute('aria-current', 'page');

  await page.goto('/tools');
  const find = page.getByLabel('Find a tool');
  await find.fill('loan');
  await expect(page.getByTestId('tool-tile')).toHaveText([/^Emergency fund/, /^Loan/]);
  await find.fill('receipt split');
  await expect(page.getByTestId('tool-tile')).toHaveText([/^Split a receipt/]);
  await expect(board.getByRole('heading', { name: 'Calculators', exact: true })).toHaveCount(0);
  await find.fill('zebra');
  await expect(page.getByTestId('tool-tile')).toHaveCount(0);
  await expect(page.getByText('No tool by that name.')).toBeVisible();
  await find.press('Escape');
  await expect(page.getByTestId('tool-tile')).toHaveCount(12);
});

test('Backup’s buttons reach the Backup page’s own flows: the save, the restore’s confirm, safety copy and second press, a kept copy’s confirm, the photo chooser', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '2500000' });
  // The day's copy, which the app takes on opening, so the Safety copies group has one to offer.
  await waitForSafetyCopy(page);
  await page.goto('/account?section=backup');
  const pane = page.getByTestId('settings-backup');

  // Save: today's file, and the line says when.
  const saved = page.waitForEvent('download');
  await pane.getByRole('button', { name: 'Download backup', exact: true }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toMatch(/^expanses-backup-\d{4}-\d{2}-\d{2}\.sqlite3$/);
  await expect(pane).toContainText('Last saved today');
  const path = (await file.path())!;

  // Restore from a file: the button opens the real chooser; the first question can be said no to, and nothing changes.
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  const chooser = page.waitForEvent('filechooser');
  await pane.getByRole('button', { name: 'Choose file…', exact: true }).click();
  await (await chooser).setFiles(path);
  await expect.poll(() => asked).toContain('Replace ALL data on this device with "');
  await expect(page.getByTestId('restore-confirm')).toHaveCount(0);

  // Said yes: the safety copy downloads first, then the second press waits with Cancel apart from it. Cancel.
  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  const again = page.waitForEvent('filechooser');
  await pane.getByRole('button', { name: 'Choose file…', exact: true }).click();
  await (await again).setFiles(path);
  expect((await safety).suggestedFilename()).toMatch(/^expanses-before-restore-\d{4}-\d{2}-\d{2}\.sqlite3$/);
  const confirm = page.getByTestId('restore-confirm');
  await expect(confirm).toContainText(/Check that expanses-before-restore-.*\.sqlite3 is in Downloads/);
  await expect(confirm.getByRole('button', { name: /^Replace my data with / })).toBeVisible();
  // While it waits, nothing else can start.
  await expect(pane.getByRole('button', { name: 'Download backup', exact: true })).toBeDisabled();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Download backup', exact: true })).toBeEnabled();

  // A kept copy asks the same question first; said no, nothing is replaced.
  const copies = page.locator('section', { has: page.getByRole('heading', { name: 'Safety copies on this device' }) });
  await expect(copies.getByRole('button', { name: /^Restore this copy from/ }).first()).toBeVisible();
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await copies.getByRole('button', { name: /^Restore this copy from/ }).first().click();
  await expect.poll(() => asked).toContain('Replace ALL data on this device with the copy from');
  await expect(page.getByTestId('restore-confirm')).toHaveCount(0);

  // Restore photos opens the real zip chooser; no photos yet, so no Download photos.
  const zip = page.waitForEvent('filechooser');
  await pane.getByRole('button', { name: 'Choose…', exact: true }).click();
  expect((await zip).element()).toBeTruthy();
  await expect(pane.getByRole('button', { name: /^Download photos/ })).toHaveCount(0);

  // The data is as it was.
  await page.goto('/wallet');
  await expect(walletCard(page, 'Bank Satu')).toBeVisible();
});

async function secondDevice(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

test('Workspaces & sharing and Devices read a shared workspace: members, devices, Sync, Link a device', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  await openWorkspacePage(page, 'Personal');
  await renameWorkspace(page, 'Rumah');
  await openSharePage(page);
  const code = await shareWorkspace(page, 'Andi');
  const sari = await secondDevice(browser, info);
  await sari.goto(`/join#${code}`);
  const join = sari.getByTestId('join-workspace');
  await expect(join.getByText('Rumah', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Sari');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(page);

  await page.goto('/account?section=workspaces');
  await expect(page.getByTestId('account-workspace').filter({ hasText: 'Rumah' })).toContainText('IDR · shared with Sari');
  const shared = page.getByTestId('settings-shared-with');
  await expect(shared.getByRole('heading', { name: 'Rumah is shared with' })).toBeVisible();
  await expect(shared.getByTestId('sharing-member')).toHaveText([/^AAndi · owner\s*this device/, /^SSari/]);
  // What is shared › Change… is the Share page's list.
  await shared.getByRole('link', { name: /^Change/ }).click();
  await expect(page).toHaveURL(/\/account\/workspaces\/[^/]+\/share\/what$/);
  await page.goto('/account?section=workspaces');
  await page.getByTestId('settings-shared-with').getByTestId('sharing-member').filter({ hasText: 'Sari' }).getByRole('link').click();
  await expect(page.getByTestId('member-page')).toBeVisible();

  await page.goto('/account?section=devices');
  const devices = page.getByTestId('settings-devices');
  await expect(devices.getByRole('heading', { name: 'Rumah' })).toBeVisible();
  await expect(devices.getByTestId('sharing-device')).toHaveCount(2);
  await expect(devices.getByTestId('sharing-device').filter({ hasText: 'this device' })).toContainText('Andi');
  await expect(devices.getByTestId('sharing-sync-row')).toBeVisible();
  // Link a device is the member page's own invite: a code, and where to enter it.
  await devices.getByRole('button', { name: 'Link a device…' }).click();
  await expect(page.getByTestId('invite-code')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('On the other device, choose Add workspace › Join with a code and enter this code.')).toBeVisible();
});

test('a page Settings opens goes back to Settings at its own section, and a workspace put away or deleted lands on Workspaces & sharing', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '2500000' });
  // A section chosen here is the one remembered; the pages below still go back to their own.
  await page.goto('/account');
  await section(page, 'About').click();
  await expect(page).toHaveURL(/\?section=about$/);

  const back = page.getByRole('main').getByRole('link', { name: 'Settings', exact: true });
  await page.goto('/account?section=workspaces');
  await workspaceLine(page, 'Personal').getByTestId('workspace-open').click();
  await expect(page.getByTestId('ws-name-row')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Account', exact: true })).toHaveCount(0);
  await back.click();
  await expect(page).toHaveURL(/\/account\?section=workspaces$/);
  await expect(section(page, 'Workspaces & sharing')).toHaveAttribute('aria-current', 'page');

  await page.goto('/settings/activity');
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/account\?section=activity$/);
  await expect(page.getByTestId('settings-activity')).toBeVisible();

  // Split a receipt is a tool: back is Tools.
  await page.goto('/transactions/receipt-split/start');
  await page.getByRole('main').getByRole('link', { name: 'Tools', exact: true }).click();
  await expect(page).toHaveURL(/\/tools$/);

  // Archive, then Restore and Delete from the archived one's page: each lands on Workspaces & sharing, not on About.
  await page.goto('/account?section=workspaces');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Kiosk');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByTestId('settings-about')).toBeVisible();
  await page.goto('/account?section=workspaces');
  await workspaceLine(page, 'Kiosk').getByTestId('workspace-open').click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to archive' }).click();
  await expect(page).toHaveURL(/\/account\?section=workspaces$/);
  await expect(page.getByTestId('archived-workspace')).toHaveCount(1);
  await page.getByTestId('archived-workspace').click();
  await page.getByTestId('restore-workspace').click();
  await expect(page).toHaveURL(/\/account\?section=workspaces$/);
  await workspaceLine(page, 'Kiosk').getByTestId('workspace-open').click();
  const del = page.getByTestId('delete-workspace');
  await del.click();
  await expect(del).toHaveText('Click again to delete');
  await del.click();
  await expect(page).toHaveURL(/\/account\?section=workspaces$/);
  await expect(page.getByTestId('account-workspace')).toHaveCount(1);
});

test('no reminder to back up over Backup itself: ?section=backup and /backup leave it out, other sections keep it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '2500000' });
  const reminder = page.getByTestId('desk-notices').getByRole('status').filter({ hasText: 'Not backed up' });
  await page.goto('/account?section=workspaces');
  await expect(reminder).toBeVisible();
  await page.goto('/account?section=backup');
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await expect(reminder).toHaveCount(0);
  // Chosen here, Backup is also what a plain /account shows: still no reminder over it.
  await section(page, 'Devices').click();
  await expect(reminder).toBeVisible();
  await section(page, 'Backup').click();
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await page.goto('/account');
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await expect(reminder).toHaveCount(0);
  await page.goto('/backup');
  await expect(page.getByTestId('settings-backup')).toBeVisible();
  await expect(reminder).toHaveCount(0);
});
