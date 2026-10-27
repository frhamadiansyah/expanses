import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { openAccount, openCard, walletCard } from './accounts';
import { fillDay, openNewAsset } from './add-asset';
import { addForm, addTransaction, addTransfer, fillAmount, openAmount, saveButton } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';
import { openDrawers } from './drawers';
import { openMemberPage, openNetWorthPage, openSharePage, openWorkspacePage, openWorkspaceSharePage, renameWorkspace, shareWorkspace } from './workspace-page';

/*
 * Household sharing, end to end (spec §11, §13 `sharing.spec.ts`): two people, each in their own browser — two
 * contexts, so two devices with their own OPFS database and their own keys in IndexedDB (`WebKeyStore`) — sharing one
 * workspace through the local relay Worker the Playwright config starts.
 *
 * The owner shares a workspace that already has history; the other person joins it; both record; each corrects the
 * other's purchase; the owner removes the other's device, which rotates the book's key; both end on the same Cashflow
 * total. Written once, run at both widths: the phone project runs it too.
 */

test.describe.configure({ timeout: 300_000 });

const phoneProject = (info: TestInfo) => info.project.name === 'phone';

/** A second device: a context of its own, the same shape as the project's. */
async function secondDevice(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    deviceScaleFactor: use.deviceScaleFactor,
    userAgent: use.userAgent,
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return page;
}

/** The app comes back to the foreground: every shared book syncs (spec §9.4). */
async function foreground(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/** Waits until `check` passes, bringing the app to the foreground between tries so it pulls. */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await foreground(page);
    await check();
  }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
}

/** Account → the workspace's ›: its own page. */
async function openWorkspaceSettings(page: Page, name: string) {
  await openWorkspacePage(page, name);
}

async function openSwitcher(page: Page, phone: boolean) {
  if (phone) {
    // The Cashflow corner's menu is names only; the shared-with line is the sheet's, which the wide screen's sidebar opens.
    await page.goto('/transactions');
    await page.getByRole('button', { name: /^Workspace, / }).click();
    await expect(page.getByTestId('workspace-menu').getByTestId('workspace-choice').filter({ hasText: 'Home' })).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toBeVisible();
}

/** A picture of the screen for a reviewer, only when SHARING_SHOTS names a folder for them. */
async function shot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.SHARING_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${info.project.name}-${name}.png`), fullPage: true });
}

/** The row of a purchase on Cashflow's list, by what it was called. */
const rowOf = (page: Page, description: string) => page.getByTestId('transaction-row').filter({ hasText: description });

/** A purchase's receipt: the row's tap on a phone, the ⓘ at its end on a wide screen. */
async function openReceipt(page: Page, phone: boolean, description: string) {
  await page.goto('/transactions');
  // The row's face, not the category circle beside it (whose name is "Category for …").
  if (phone) await rowOf(page, description).getByRole('button', { name: new RegExp(`^(?!Category for).*${description}`) }).click();
  else await page.getByRole('link', { name: `Receipt for ${description}` }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
}

/** Corrects what a purchase came to, from its receipt: the phone's Add screen on it, the desktop's card in a sheet. */
async function correct(page: Page, phone: boolean, description: string, amount: string) {
  await openReceipt(page, phone, description);
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  if (phone) {
    const form = page.getByRole('form', { name: 'Edit a transaction' });
    await form.getByRole('button', { name: 'Amount', exact: true }).click();
    const keypad = page.getByTestId('keypad');
    await keypad.getByRole('button', { name: 'C', exact: true }).click();
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    await saveButton(form).click();
    await expect(form).toHaveCount(0);
  } else {
    const sheet = page.getByRole('dialog', { name: 'Edit transaction' });
    await sheet.getByLabel('Amount', { exact: true }).fill(amount);
    await saveButton(sheet).click();
    await expect(sheet).toHaveCount(0);
  }
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
}

/** Cashflow's total for the month on show. */
async function cashflowTotal(page: Page, expected: string) {
  await page.goto('/transactions');
  await expect(page.getByTestId('period-total')).toHaveText(expected);
}

/** Reads the device's own database, the way the app's Backup screen hands it over. */
async function backupOf(page: Page, info: TestInfo, name: string): Promise<BetterSqlite3.Database> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = join(info.outputDir, `${name}.sqlite3`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, readFileSync((await (await downloaded).path())!));
  return new BetterSqlite3(file, { readonly: true });
}

test('two people share a workspace: join, record on both, correct each other, remove, rotate, same total', async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);

  // Fandri's workspace already has history before it is shared.
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'History lunch', paidWith: 'Fandri Bank', category: 'Restaurants', amount: '50000' });

  // Named Home, so the joiner's own Personal and the shared one never read alike.
  await openWorkspaceSettings(page, 'Personal');
  await renameWorkspace(page, 'Home');
  await expect(page.getByText('Now called Home.')).toBeVisible();

  // Share this workspace: the Share page, a name (the explainer is behind its ⓘ), then the invite once the history has gone up.
  await expect(page.getByTestId('ws-share-row')).toContainText('Off');
  await openSharePage(page);
  await expect(page.getByTestId('share-button')).toBeDisabled();
  await page.getByRole('button', { name: 'About Name' }).click();
  await expect(page.getByRole('form', { name: 'Share this workspace' })).toContainText('A replaced or restored phone needs a new invite.');
  const code = await shareWorkspace(page, 'Fandri');
  expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await expect(page.getByTestId('invite-link')).toHaveText(`cicis://join/${code}`);
  await expect(page.getByTestId('sharing-status')).toContainText('Up to date');
  await expect(page.getByTestId('sharing-waiting')).toContainText('Invite open');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('invite-card')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(code);
  await shot(page, info, '1-invite');

  // Dewi joins on her own device, by the link.
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  if (phone) {
    // The link's code rides in the fragment, which no server sees, and leaves the address as soon as it is read.
    await dewi.goto(`/join#${code}`);
    await expect(dewi).toHaveURL(/\/join$/);
  } else {
    await dewi.goto(`/join#${code}`);
  }
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(join.getByText('Fandri', { exact: true })).toBeVisible();
  await join.getByLabel('Name').fill('Dewi');
  await shot(dewi, info, '2-join-preview');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // She lands in Home, and the history is there, paid by Fandri from what Fandri paid with.
  await dewi.goto('/transactions');
  await expect(rowOf(dewi, 'History lunch')).toContainText('Fandri Bank · paid by Fandri');
  await shot(dewi, info, '3-list-paid-by');

  // The switcher says who the workspace is shared with.
  await openSwitcher(dewi, phone);
  if (!phone) await expect(dewi.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Home' })).toContainText('Shared with Fandri');
  await dewi.keyboard.press('Escape');

  // The receipt of a purchase Fandri paid for says both what with and who, and nothing on it leads to the
  // placeholder account it is posted against on Dewi's device — not its account, card, statement or balance.
  await openReceipt(dewi, phone, 'History lunch');
  const receipt = dewi.locator('main');
  await expect(receipt).toContainText('Paid with');
  await expect(receipt).toContainText('Fandri Bank');
  await expect(receipt).toContainText('Paid by');
  await expect(receipt.getByText('Fandri', { exact: true })).toBeVisible();
  await shot(dewi, info, '4-receipt');
  await expect(receipt.locator('a[href*="/accounts/"], a[href*="/cards/"], a[href*="account="], a[href*="/net-worth/assets/"]')).toHaveCount(0);
  await dewi.goto('/transactions');
  await expect(rowOf(dewi, 'History lunch').locator('a[href*="/accounts/"], a[href*="/cards/"], a[href*="account="]')).toHaveCount(0);

  // Invites are an owner's: Dewi, a member, is told to ask an owner rather than offered Link a device.
  await openWorkspaceSharePage(dewi, 'Home');
  await expect(dewi.getByTestId('invite-code')).toHaveCount(0);
  await openMemberPage(dewi, '(me)');
  await expect(dewi.getByTestId('ask-owner-to-link')).toBeVisible({ timeout: 15_000 });
  await expect(dewi.getByRole('button', { name: 'Link a device' })).toHaveCount(0);
  await expect(dewi.getByRole('button', { name: 'Invite someone' })).toHaveCount(0);
  await dewi.goto('/transactions');

  // Both record. Each sees the other's purchase, labelled with what the other paid with.
  await addTransaction(dewi, { description: 'Dewi groceries', paidWith: 'Dewi Bank', category: 'Groceries', amount: '20000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Fandri dinner', paidWith: 'Fandri Bank', category: 'Restaurants', amount: '30000' });
  await eventually(page, () => expect(rowOf(page, 'Dewi groceries')).toContainText('Dewi Bank · paid by Dewi', { timeout: 1_000 }));
  await expect(rowOf(page, 'Fandri dinner')).not.toContainText('paid by');
  await eventually(dewi, () => expect(rowOf(dewi, 'Fandri dinner')).toContainText('Fandri Bank · paid by Fandri', { timeout: 1_000 }));

  // Each corrects the other's purchase. The payer stays the payer.
  await correct(page, phone, 'Dewi groceries', '25000');
  await correct(dewi, phone, 'Fandri dinner', '35000');
  await eventually(page, () => expect(rowOf(page, 'Fandri dinner')).toContainText('35.000', { timeout: 1_000 }));
  await eventually(dewi, () => expect(rowOf(dewi, 'Dewi groceries')).toContainText('25.000', { timeout: 1_000 }));
  await expect(rowOf(dewi, 'Dewi groceries')).not.toContainText('paid by');
  await expect(rowOf(page, 'Dewi groceries')).toContainText('paid by Dewi');

  // One Cashflow total on both: 50.000 + 25.000 + 35.000.
  await cashflowTotal(page, 'Rp 110.000');
  await cashflowTotal(dewi, 'Rp 110.000');

  // The owner removes Dewi's device. The relay drops it, and the owner's device rotates the key to epoch 2.
  await openWorkspaceSharePage(page, 'Home');
  const section = page.getByTestId('sharing-section');
  await expect(section.getByTestId('sharing-member')).toHaveCount(2);
  await expect(section.getByTestId('invite-code')).toHaveCount(0);
  await shot(page, info, '5-members');
  await openMemberPage(page, 'Dewi');
  const memberPage = page.getByTestId('member-page');
  await expect(memberPage.getByTestId('sharing-device')).toHaveCount(1);
  await shot(page, info, '5b-member');
  await memberPage.getByRole('button', { name: /, Dewi$/ }).click();
  await memberPage.getByRole('button', { name: /^Remove Dewi’s / }).click();
  await expect(memberPage.getByTestId('sharing-device')).toHaveCount(0, { timeout: 30_000 });
  const owner = await backupOf(page, info, 'owner');
  try {
    expect(owner.prepare('SELECT epoch FROM shared_books').get()).toEqual({ epoch: 2 });
    expect(owner.prepare('SELECT count(*) AS n FROM book_epoch_keys').get()).toEqual({ n: 2 });
    expect(owner.prepare('SELECT count(*) AS n FROM book_devices WHERE removed_at IS NOT NULL').get()).toEqual({ n: 1 });
  } finally {
    owner.close();
  }

  // Dewi's device is told it was removed (final review, I2), and keeps what it already holds, read-only.
  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('Removed from this workspace', { timeout: 1_000 }));
  await shot(dewi, info, '6-removed-status');
  await expectReadOnly(dewi, phone, 'Removed from this workspace');

  // And both still read the same Cashflow total.
  await cashflowTotal(page, 'Rp 110.000');
  await cashflowTotal(dewi, 'Rp 110.000');
});

/** Account > Add workspace offers Join with a code; it opens the join sheet, and Cancel or the backdrop close the choices. */
test('Add workspace offers New workspace or Join with a code, and Join opens the join sheet', async ({ page }) => {
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  const choices = page.getByTestId('add-workspace-sheet');
  await expect(choices.getByTestId('new-workspace')).toBeVisible();
  await expect(choices.getByTestId('join-workspace-choice')).toBeVisible();
  await choices.getByRole('button', { name: 'Cancel' }).click();
  await expect(choices).toHaveCount(0);

  await page.getByTestId('add-workspace').click();
  await choices.click({ position: { x: 4, y: 4 } });
  await expect(choices).toHaveCount(0);

  await page.getByTestId('add-workspace').click();
  await page.getByTestId('join-workspace-choice').click();
  await expect(choices).toHaveCount(0);
  const join = page.getByTestId('join-workspace');
  await expect(join).toBeVisible();
  await expect(join.getByPlaceholder('XXXX-XXXX-…')).toBeVisible();
});

/** §6.5 step 0 (ruled O3): a workspace kept in another currency than yours is refused before anything is made. */
test('a workspace in another currency than yours cannot be shared, and says why', async ({ page }, info) => {
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Singapore');
  await sheet.getByLabel('Reads in').selectOption('SGD');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);

  await openWorkspaceSharePage(page, 'Singapore');
  await expect(page.getByText("This workspace keeps its money in SGD; this app's own accounts are kept in IDR. Sharing across currencies isn't supported yet.")).toBeVisible();
  await expect(page.getByTestId('share-button')).toHaveCount(0);
  await shot(page, info, '7-currency-refusal');
});

/** Fandri shares a workspace called Home and Dewi joins it: the start of every edge below. */
async function shareAndJoin(page: Page, dewi: Page) {
  await openWorkspaceSettings(page, 'Personal');
  await renameWorkspace(page, 'Home');
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await openSharePage(page);
  const code = await shareWorkspace(page, 'Fandri');
  await dewi.goto(`/join#${code}`);
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Dewi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
}

/** Settings → Home, then the destructive row and its confirmation sheet's ✓. */
async function confirmDestructive(page: Page, row: string, sheet: string, confirm: string) {
  await page.getByRole('button', { name: row, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: sheet });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
}

/** A share that ended here is read-only: said above the list, and no way to add. */
async function expectReadOnly(page: Page, phone: boolean, line: string) {
  await page.goto('/transactions');
  await expect(page.getByTestId('read-only-notice')).toContainText(line);
  await expect(page.getByTestId('read-only-notice')).toContainText('read-only');
  if (phone) await expect(page.locator('header').getByRole('button', { name: 'Add a transaction' })).toHaveCount(0);
  else await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toHaveCount(0);
}

test('the last owner cannot leave; made an owner, the other can invite; then the first owner leaves', async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  // Fandri is the only owner: Leave is refused, in words.
  await openWorkspaceSharePage(page, 'Home');
  await eventually(page, () => expect(page.getByTestId('sharing-member')).toHaveCount(2, { timeout: 1_000 }));
  await confirmDestructive(page, 'Leave', 'Leave this workspace?', 'Leave');
  await expect(page.getByRole('alert')).toContainText('Make someone else owner first.');
  await shot(page, info, '8-last-owner-refused');

  // Make owner, on Dewi's page: she becomes one, and can invite.
  await openMemberPage(page, 'Dewi');
  await page.getByRole('button', { name: 'Make Dewi an owner' }).click();
  await expect(page.getByTestId('member-page')).toContainText('Owner');
  await expect(page.getByRole('button', { name: 'Make Dewi an owner' })).toHaveCount(0);
  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-member').filter({ hasText: 'Dewi (me)' })).toContainText('Owner', { timeout: 1_000 }));
  await openMemberPage(dewi, 'Dewi (me)');
  await dewi.getByRole('button', { name: 'Invite someone' }).click();
  await expect(dewi.getByTestId('invite-code')).toHaveText(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/, { timeout: 30_000 });

  // Now Fandri may leave: the book stays on Fandri's device, read-only.
  await openWorkspaceSharePage(page, 'Home');
  await confirmDestructive(page, 'Leave', 'Leave this workspace?', 'Leave');
  await expect(page.getByTestId('sharing-status')).toContainText('Left this workspace', { timeout: 30_000 });
  await expectReadOnly(page, phone, 'Left this workspace');
  await shot(page, info, '9-left-read-only');

  // Dewi sees Fandri gone.
  await openWorkspaceSharePage(dewi, 'Home');
  await openMemberPage(dewi, 'Dewi (me)');
  await expect(dewi.getByTestId('sharing-device')).toHaveCount(1);
  await dewi.goBack();
  await openMemberPage(dewi, 'Fandri');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-device')).toHaveCount(0, { timeout: 1_000 }));
});

test('an owner stops sharing: the other side says who stopped it, and can add nothing', async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  await openWorkspaceSharePage(page, 'Home');
  await confirmDestructive(page, 'Stop sharing', 'Stop sharing?', 'Stop sharing');
  // On the owner's own device it is an ordinary workspace again, which could be shared anew.
  await expect(page.getByTestId('ws-share-row')).toContainText('Off', { timeout: 30_000 });

  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('No longer shared by Fandri', { timeout: 1_000 }));
  await shot(dewi, info, '10-stopped-status');
  await expectReadOnly(dewi, phone, 'No longer shared by Fandri');
  await openSwitcher(dewi, phone);
  if (!phone) await expect(dewi.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Home' })).toContainText('No longer shared by Fandri');
});

/** C1 (final review): a share the owner ended and made again is rejoined by the member's read-only copy, and both converge. */
test("an owner stops and shares again: the member's read-only copy rejoins through a link-a-device invite, and both converge", async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);
  await dewi.goto('/transactions');
  await addTransaction(dewi, { description: 'Dewi before', paidWith: 'Dewi Bank', category: 'Groceries', amount: '20000' });
  await page.goto('/transactions');
  await eventually(page, () => expect(rowOf(page, 'Dewi before')).toContainText('paid by Dewi', { timeout: 1_000 }));

  // Fandri stops sharing; Dewi's copy goes read-only.
  await openWorkspaceSharePage(page, 'Home');
  await confirmDestructive(page, 'Stop sharing', 'Stop sharing?', 'Stop sharing');
  await expect(page.getByTestId('ws-share-row')).toContainText('Off', { timeout: 30_000 });
  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('No longer shared by Fandri', { timeout: 1_000 }));
  await expectReadOnly(dewi, phone, 'No longer shared by Fandri');

  // Fandri shares it again, as the same person: the members are Fandri and the remembered Dewi, nobody twice.
  await openWorkspacePage(page, 'Home');
  await openSharePage(page);
  // The name is remembered from last time.
  await expect(page.getByTestId('share-name')).toHaveValue('Fandri');
  const first = await shareWorkspace(page, 'Fandri');
  const section = page.getByTestId('sharing-section');
  await expect(section.getByTestId('sharing-member')).toHaveCount(2);
  await expect(section.getByTestId('sharing-member').filter({ hasText: 'Fandri (me)' })).toContainText('Owner');
  await expect(section.getByTestId('sharing-member').filter({ hasText: 'Dewi' })).toContainText('Member');
  // Dewi's copy rejoins as Dewi: an invite that links a device for her, made from her page.
  await openMemberPage(page, 'Dewi');
  await page.getByRole('button', { name: 'Link a device for Dewi' }).click();
  await expect(page.getByTestId('invite-code')).not.toHaveText(first, { timeout: 30_000 });
  const code = (await page.getByTestId('invite-code').textContent())!.trim();
  await shot(page, info, '11-link-for-dewi');

  await dewi.goto(`/join#${code}`);
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(join.getByText('This device joins as Dewi.')).toBeVisible();
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  // Her copy moves onto the share made again: Join says so, and asks, before anything is claimed (recovery review, N1).
  const replace = dewi.getByRole('dialog', { name: 'Replace this workspace’s sharing?' });
  await expect(replace).toContainText('This replaces the sharing of Home on this device with Fandri’s share. Existing rows stay and are merged.');
  await shot(dewi, info, '12a-replace-confirm');
  await replace.getByRole('button', { name: 'Replace and join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // Shared again on Dewi's side: syncing, no longer read-only, and everything from before is still there.
  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('Up to date', { timeout: 1_000 }));
  await shot(dewi, info, '12-rejoined');
  await dewi.goto('/transactions');
  await expect(dewi.getByTestId('read-only-notice')).toHaveCount(0);
  await expect(rowOf(dewi, 'Dewi before')).toBeVisible();

  // Both record again, and each sees the other's.
  await addTransaction(dewi, { description: 'Dewi after', paidWith: 'Dewi Bank', category: 'Groceries', amount: '15000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Fandri after', paidWith: 'Fandri Bank', category: 'Restaurants', amount: '30000' });
  await eventually(page, () => expect(rowOf(page, 'Dewi after')).toContainText('Dewi Bank · paid by Dewi', { timeout: 1_000 }));
  await eventually(dewi, () => expect(rowOf(dewi, 'Fandri after')).toContainText('Fandri Bank · paid by Fandri', { timeout: 1_000 }));
  await cashflowTotal(page, 'Rp 65.000');
  await cashflowTotal(dewi, 'Rp 65.000');
});

/*
 * Joint net worth, end to end (joint-net-worth spec §6–§8, plan Task 11): inside the shared Home, Fandri proposes one
 * tax ID, Dewi confirms, each reviews and shares; both phones read the household's figure and whose part is whose.
 * Dewi pays with Fandri's shared card, and it is on Fandri's statement; Fandri sends Dewi 5 jt, and both accounts move.
 * They change to separate tax IDs, Fandri stops sharing his bank account and it leaves Dewi's phone; Dewi leaves, and
 * her Net worth is her own again.
 */

/** Account → Home → Share → Net worth: the page that holds the section. */
async function netWorthSection(page: Page) {
  await openWorkspaceSharePage(page, 'Home');
  await openNetWorthPage(page);
  return page.getByTestId('net-worth-section');
}

/** This person's review of their items, then Share: every activation asks for its own. */
async function reviewAndShare(page: Page, info: TestInfo, name: string, says?: string) {
  const section = await netWorthSection(page);
  // The Shared row says Review until this person has pressed Share; the list opens with the Review items notice.
  await eventually(page, () => expect(section.getByTestId('networth-shared-row')).toContainText('Review', { timeout: 1_000 }));
  await section.getByTestId('networth-shared-row').click();
  const review = page.getByTestId('net-worth-review');
  await eventually(page, () => expect(review).toBeVisible({ timeout: 1_000 }));
  // What sharing sends is read whole, never cut off at the row's edge: the notice opens it in full.
  if (says) {
    await review.getByRole('button').first().click();
    await expect(page.getByRole('alertdialog').getByText(says)).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click();
  }
  await shot(page, info, name);
  await page.getByTestId('net-worth-share').click();
  await expect(review).toHaveCount(0, { timeout: 30_000 });
}

/** Net worth's figure, and — when the household files jointly — whose part is whose. */
async function netWorthReads(page: Page, figure: string, legend: string[] | null) {
  await page.goto('/net-worth');
  await eventually(page, async () => {
    await expect(page.getByTestId('net-worth')).toContainText(figure, { timeout: 1_000 });
    if (legend) for (const part of legend) await expect(page.getByTestId('owner-legend')).toContainText(part, { timeout: 1_000 });
    else await expect(page.getByTestId('owner-legend')).toHaveCount(0, { timeout: 1_000 });
  });
}

/** An own account's figure on its Wallet card. */
async function accountReads(page: Page, name: string, figure: string) {
  await eventually(page, async () => {
    await page.goto('/wallet');
    await expect(walletCard(page, name)).toHaveAccessibleName(new RegExp(figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 2_000 });
  });
}

test('two people share their net worth: one tax ID, pay with the other’s card, a transfer, separate, don’t share, leave', async ({ page, browser }, info) => {
  test.setTimeout(900_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);

  // Fandri keeps a bank account and a card with a statement; Dewi a bank account.
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await openCard(page, { name: 'Fandri Card' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Fandri Card' }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  // Fandri proposes one tax ID with Dewi.
  let section = await netWorthSection(page);
  await eventually(page, () => expect(section.getByTestId('share-net-worth')).toBeVisible({ timeout: 1_000 }));
  const setup = page.getByTestId('net-worth-setup');
  await setup.getByTestId('filing-joint').click();
  await shot(page, info, '13-net-worth-setup');
  await setup.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(section.getByTestId('net-worth-waiting')).toContainText('Waiting for Dewi', { timeout: 30_000 });

  // Dewi is asked, and confirms.
  let theirs = await netWorthSection(dewi);
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-asked')).toContainText('Fandri asks to share net worth', { timeout: 1_000 }));
  await shot(dewi, info, '14-net-worth-asked');
  await theirs.getByRole('button', { name: 'Confirm', exact: true }).click();
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-status')).toContainText('Shared with Fandri', { timeout: 1_000 }));

  // Each reviews their items and shares them.
  await reviewAndShare(dewi, info, '15-review-joint', 'For the joint tax return, each item also goes to Fandri with its row of the tax report');
  await reviewAndShare(page, info, '15-review-joint', 'For the joint tax return, each item also goes to Dewi with its row of the tax report');

  // Both read the household's figure — 10 jt + 5 jt — and whose part is whose.
  await netWorthReads(page, '15.000.000', ['Fandri', '10 jt', 'Dewi', '5 jt']);
  await shot(page, info, '16-net-worth-joint');
  await netWorthReads(dewi, '15.000.000', ['Fandri', '10 jt', 'Dewi', '5 jt']);
  await shot(dewi, info, '16-net-worth-joint');

  // Fandri's shared account opens its own page on Dewi's phone.
  await openDrawers(dewi);
  await dewi.getByRole('link', { name: /^Fandri's Fandri Bank, / }).click();
  await expect(dewi).toHaveURL(/\/net-worth\/shared\//);
  await expect(dewi.getByRole('heading', { name: 'Fandri Bank' })).toBeVisible();
  await expect(dewi.locator('main')).toContainText('10.000.000');
  await shot(dewi, info, '16b-partner-item');

  // The Assets page lists what Fandri shares, read-only, under his name.
  await eventually(dewi, async () => {
    await dewi.goto('/net-worth/assets');
    const group = dewi.locator('section').filter({ has: dewi.getByText('Shared by Fandri', { exact: true }) });
    await expect(group).toContainText('Fandri Bank', { timeout: 2_000 });
  });
  await shot(dewi, info, '16a-partner-assets');

  // With one tax ID the tax report is the household's, and says it holds both people's items. (The accounts here were
  // opened this year, so the only year a report can start for, 2025, holds none of them.)
  await eventually(dewi, async () => {
    await dewi.goto('/tax-report');
    await expect(dewi.locator('main')).toContainText('Joint report · Fandri and Dewi', { timeout: 2_000 });
    await expect(dewi.locator('main')).toContainText('Every item of both members is in it', { timeout: 2_000 });
  });
  await shot(dewi, info, '16c-joint-tax-report');

  // Dewi pays with Fandri's shared card; it lands on Fandri's real card, on its statement.
  await dewi.goto('/transactions');
  await dewi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(dewi);
  await openAmount(form);
  await fillAmount(dewi, form, '200000');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  const paidWith = dewi.getByRole('dialog', { name: 'Paid with' });
  await paidWith.getByRole('radio', { name: 'Credit cards' }).click();
  await paidWith.getByRole('button', { name: 'Fandri Card, Fandri’s, shared', exact: true }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await dewi.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Dewi dinner');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Fandri Card' }).click();
  await cardPage(page, 'Statement');
  await eventually(page, () => expect(page.getByTestId('statement-line').filter({ hasText: 'Dewi dinner' })).toContainText('200.000', { timeout: 1_000 }));
  await shot(page, info, '17-card-statement');

  // Fandri sends Dewi 5 jt, to her shared account: his goes down, hers goes up.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const transfer = addForm(page);
  await transfer.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await transfer.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'Fandri Bank', exact: true }).click();
  await openAmount(transfer);
  await fillAmount(page, transfer, '5000000');
  await transfer.getByRole('button', { name: /^To/ }).click();
  const to = page.getByRole('dialog', { name: 'To', exact: true });
  // To is the same sheet as From and Paid with: a partner's row is named with whose it is, as Paid with names it.
  await to.getByRole('region', { name: 'Dewi’s, shared with Home' }).getByRole('button', { name: 'Dewi Bank, Dewi’s, shared with Home', exact: true }).click();
  await transfer.getByLabel('Note').fill('For the house');
  await shot(page, info, '18-transfer-to-partner');
  await saveButton(transfer).click();
  await expect(transfer).toHaveCount(0);
  await accountReads(page, 'Fandri Bank', '5.000.000');
  await accountReads(dewi, 'Dewi Bank', '10.000.000');
  // The household's figure is what it was, less the dinner on the card: 15 jt − 200.000.
  await netWorthReads(page, '14.800.000', ['Fandri', 'Dewi']);
  await netWorthReads(dewi, '14.800.000', ['Fandri', 'Dewi']);

  // Fandri changes to separate tax IDs; Dewi confirms; each reviews again.
  section = await netWorthSection(page);
  await section.getByTestId('net-worth-filing').click();
  await setup.getByTestId('filing-separate').click();
  await setup.getByRole('button', { name: 'Invite', exact: true }).click();
  theirs = await netWorthSection(dewi);
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-asked')).toContainText('Separate', { timeout: 1_000 }));
  await theirs.getByRole('button', { name: 'Confirm', exact: true }).click();
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-filing')).toContainText('Filed separately', { timeout: 1_000 }));
  await reviewAndShare(dewi, info, '19-review-separate');
  await reviewAndShare(page, info, '19-review-separate');

  // Separately, Dewi's Accounts lists what Fandri shares, counted in nothing.
  const fandriShared = dewi.locator('section').filter({ has: dewi.getByText("Fandri's, shared", { exact: true }) });
  const sharedRows = dewi.locator('[data-testid^="shared-item-"]');
  await eventually(dewi, async () => {
    await dewi.goto('/wallet');
    await expect(fandriShared).toContainText('Fandri Bank', { timeout: 2_000 });
  });
  await shot(dewi, info, '20-accounts-shared');

  // Fandri stops sharing his bank account; it leaves Dewi's phone.
  await page.goto('/wallet');
  await walletCard(page, 'Fandri Bank').click();
  await page.getByLabel('Share with Household').selectOption({ label: "Don't share" });
  await expect(page.getByLabel('Share with Household')).toHaveValue('hidden');
  await eventually(dewi, async () => {
    await dewi.goto('/wallet');
    await expect(sharedRows.filter({ hasText: 'Fandri Card' })).toHaveCount(1, { timeout: 2_000 });
    await expect(sharedRows.filter({ hasText: 'Fandri Bank' })).toHaveCount(0, { timeout: 2_000 });
  });

  // Dewi leaves: her Net worth is her own again, and nothing of Fandri's is listed.
  theirs = await netWorthSection(dewi);
  await confirmDestructive(dewi, 'Stop sharing my net worth', 'Stop sharing net worth?', 'Stop sharing');
  await eventually(dewi, () => expect(theirs.getByTestId('share-net-worth')).toBeVisible({ timeout: 1_000 }));
  await netWorthReads(dewi, '10.000.000', null);
  await dewi.goto('/wallet');
  await expect(dewi.getByText('Dewi Bank').first()).toBeVisible();
  await expect(sharedRows).toHaveCount(0);
  await shot(dewi, info, '21-left-personal');
});


test('a transfer in a shared workspace shows on the partner’s list as "Transfer · …" with no account names, and goes when deleted', async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await openAccount(page, { subtype: 'cash', name: 'Fandri Pocket', balance: '100000' });
  await openWorkspaceSettings(page, 'Personal');
  await renameWorkspace(page, 'Home');
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await openSharePage(page);
  const code = await shareWorkspace(page, 'Fandri');
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  if (phone) {
    await dewi.goto(`/join#${code}`);
  } else {
    await dewi.goto(`/join#${code}`);
  }
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Dewi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // Fandri moves money between his own accounts in the shared workspace.
  await page.goto('/transactions');
  await addTransfer(page, { from: 'Fandri Bank', to: 'Fandri Pocket', amount: '250000', note: 'Pocket money' });
  await expect(page.getByText('Pocket money').first()).toBeVisible();
  const shadow = dewi.getByTestId('shared-transfer-row');
  await eventually(dewi, async () => {
    await dewi.goto('/transactions');
    await expect(shadow).toHaveCount(1, { timeout: 1_000 });
  });
  await expect(shadow).toContainText('Transfer · Pocket money');
  await expect(shadow).toContainText('250.000');
  // No account name reaches the partner, in the row or anywhere on the page.
  await expect(dewi.locator('main')).not.toContainText('Fandri Pocket');
  await expect(dewi.locator('main')).not.toContainText('Fandri Bank');
  // The recorder sees its own transfer once, and no redacted copy.
  await expect(page.getByTestId('shared-transfer-row')).toHaveCount(0);

  // Deleted by its recorder, it goes from the partner's list.
  await page.goto('/transactions');
  await page.locator('li', { hasText: /Pocket money/ }).first().click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await eventually(dewi, async () => {
    await dewi.goto('/transactions');
    await expect(shadow).toHaveCount(0, { timeout: 1_000 });
  });
});

/*
 * A joint account (0097): Fandri shares his bank account and turns Joint account on. Dewi's Paid with lists it with a
 * Joint tag and she pays from it; both phones list the rows recorded in the shared workspace against it, each saying who
 * recorded it. The row of the other is read only; switched off, the partner is back to the balance and the total.
 */
test('a joint account: the partner pays from it, both list the same rows with who recorded each, either can change or delete and restore any row, off reverts', async ({ page, browser }, info) => {
  test.setTimeout(900_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  const section = await netWorthSection(page);
  await eventually(page, () => expect(section.getByTestId('share-net-worth')).toBeVisible({ timeout: 1_000 }));
  const setup = page.getByTestId('net-worth-setup');
  await setup.getByTestId('filing-joint').click();
  await setup.getByRole('button', { name: 'Invite', exact: true }).click();
  const theirs = await netWorthSection(dewi);
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-asked')).toContainText('Fandri asks to share net worth', { timeout: 1_000 }));
  await theirs.getByRole('button', { name: 'Confirm', exact: true }).click();
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-status')).toContainText('Shared with Fandri', { timeout: 1_000 }));
  await reviewAndShare(dewi, info, 'j1-review');
  await reviewAndShare(page, info, 'j1-review');

  // Fandri's account page: the Joint account switch sits under Share with Household, off.
  await page.goto('/wallet');
  await walletCard(page, 'Fandri Bank').click();
  const joint = page.getByRole('checkbox', { name: 'Joint account' });
  await expect(joint).not.toBeChecked();
  await expect(page.getByTestId('joint-row')).toHaveCount(0);
  await joint.click({ force: true });
  await expect(joint).toBeChecked();
  await shot(page, info, 'j2-switch-on');

  // Dewi's Paid with lists it with the Joint tag, and she pays from it.
  const paidWithJoint = dewi.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Fandri Bank, Fandri’s, shared', exact: true });
  await eventually(dewi, async () => {
    await dewi.goto('/transactions');
    await dewi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
    await addForm(dewi).getByRole('button', { name: /^Paid with/ }).click();
    await expect(paidWithJoint).toContainText('Joint', { timeout: 1_000 });
  });
  await dewi.goto('/transactions');
  await dewi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(dewi);
  await openAmount(form);
  await fillAmount(dewi, form, '180000');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await paidWithJoint.click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await dewi.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Dewi groceries');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Fandri records one of his own in the shared workspace from the same account.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Fandri water', paidWith: 'Fandri Bank', category: 'Groceries', amount: '50000' });

  // Both account pages list the same two rows, each with who recorded it; the balance is the holder's.
  await accountReads(page, 'Fandri Bank', '9.770.000');
  const rowsOn = (p: Page) => p.getByTestId('joint-row');
  await eventually(page, async () => {
    await page.goto('/wallet');
    await walletCard(page, 'Fandri Bank').click();
    await expect(rowsOn(page)).toHaveCount(2, { timeout: 2_000 });
  });
  await expect(rowsOn(page).filter({ hasText: 'Dewi groceries' })).toContainText('by Dewi');
  await expect(rowsOn(page).filter({ hasText: 'Fandri water' })).toContainText('by me');
  await shot(page, info, 'j3-holder-rows');
  await eventually(dewi, async () => {
    await dewi.goto('/net-worth');
    await openDrawers(dewi);
    await dewi.getByRole('link', { name: /^Fandri's Fandri Bank, / }).click();
    await expect(rowsOn(dewi)).toHaveCount(2, { timeout: 2_000 });
  });
  await expect(rowsOn(dewi).filter({ hasText: 'Dewi groceries' })).toContainText('by me');
  await expect(rowsOn(dewi).filter({ hasText: 'Fandri water' })).toContainText('by Fandri');
  await expect(dewi.locator('main')).toContainText('9.770.000');
  await shot(dewi, info, 'j3-partner-rows');

  // Equal rights: either person can change the other's row, on both phones.
  await openReceipt(page, phoneProject(info), 'Dewi groceries');
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toBeVisible();
  await expect(page.getByTestId('joint-note')).toContainText('by Dewi');
  await openReceipt(dewi, phoneProject(info), 'Fandri water');
  await expect(dewi.getByRole('button', { name: 'Edit this transaction' })).toBeVisible();

  // Fandri deletes Dewi's row: it stays on both lists as deleted, with who deleted it, and either can restore it.
  await openReceipt(page, phoneProject(info), 'Dewi groceries');
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.goto('/wallet');
  await walletCard(page, 'Fandri Bank').click();
  await expect(page.getByTestId('joint-row-deleted')).toContainText('deleted by me');
  await eventually(dewi, async () => {
    await dewi.goto('/net-worth');
    await openDrawers(dewi);
    await dewi.getByRole('link', { name: /^Fandri's Fandri Bank, / }).click();
    await expect(dewi.getByTestId('joint-row-deleted')).toContainText('deleted by Fandri', { timeout: 1_000 });
  });
  await dewi.getByTestId('joint-row-restore').click();
  await expect(dewi.getByTestId('joint-row-deleted')).toHaveCount(0);
  await expect(rowsOn(dewi)).toHaveCount(2);
  await eventually(page, async () => {
    await page.goto('/wallet');
    await walletCard(page, 'Fandri Bank').click();
    await expect(page.getByTestId('joint-row-deleted')).toHaveCount(0, { timeout: 1_000 });
    await expect(rowsOn(page)).toHaveCount(2, { timeout: 1_000 });
  });
  await shot(page, info, 'j4-restored');

  // Dewi withdraws 300.000 from the joint account to a cash account of hers that is not shared: it lands once on
  // Fandri's balance, is listed on both pages, and Fandri's phone never names her account.
  await openAccount(dewi, { subtype: 'cash', name: 'Dewi Cash', balance: '100000' });
  await dewi.goto('/transactions');
  await dewi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const withdrawal = addForm(dewi);
  await withdrawal.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await withdrawal.getByRole('button', { name: 'To' }).click();
  await dewi.getByRole('dialog', { name: 'To', exact: true }).getByRole('button', { name: 'Dewi Cash' }).first().click();
  await openAmount(withdrawal);
  await fillAmount(dewi, withdrawal, '300000');
  await withdrawal.getByRole('button', { name: /^From/ }).click();
  const fromSheet = dewi.getByRole('dialog', { name: 'From', exact: true });
  await fromSheet.getByRole('region', { name: /^Fandri’s, shared with/ }).getByRole('button', { name: /^Fandri Bank, Fandri’s, shared/ }).click();
  await withdrawal.getByLabel('Note').fill('Cash withdrawal');
  await saveButton(withdrawal).click();
  await expect(withdrawal).toHaveCount(0);
  await accountReads(page, 'Fandri Bank', '9.470.000');
  await eventually(page, async () => {
    await page.goto('/wallet');
    await walletCard(page, 'Fandri Bank').click();
    await expect(rowsOn(page).filter({ hasText: 'Cash withdrawal' })).toHaveCount(1, { timeout: 1_000 });
  });
  await expect(rowsOn(page).filter({ hasText: 'Cash withdrawal' })).toContainText('by Dewi');
  await expect(rowsOn(page).filter({ hasText: 'Cash withdrawal' })).not.toContainText('Dewi Cash');
  await eventually(dewi, async () => {
    await dewi.goto('/net-worth');
    await openDrawers(dewi);
    await dewi.getByRole('link', { name: /^Fandri's Fandri Bank, / }).click();
    await expect(rowsOn(dewi).filter({ hasText: 'Cash withdrawal' })).toHaveCount(1, { timeout: 1_000 });
  });

  // Switched off, the partner is back to the balance and the total: no rows.
  await page.goto('/wallet');
  await walletCard(page, 'Fandri Bank').click();
  await page.getByRole('checkbox', { name: 'Joint account' }).click({ force: true });
  await expect(rowsOn(page)).toHaveCount(0);
  await eventually(dewi, async () => {
    await dewi.goto('/net-worth');
    await openDrawers(dewi);
    await dewi.getByRole('link', { name: /^Fandri's Fandri Bank, / }).click();
    await expect(rowsOn(dewi)).toHaveCount(0, { timeout: 1_000 });
  });
  await expect(dewi.locator('main')).toContainText('9.470.000');
});

/*
 * The Net worth page is one list with switches: the setup carries the Shared row, the Shared list searches and switches
 * each item, an activation asks for one review, and a new asset starts Shared while sharing is active (off makes it private).
 */
test('net worth sharing: one Shared list with switches, search, N of M, and a new asset starts Shared', async ({ page, browser }, info) => {
  test.setTimeout(900_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await openAccount(page, { subtype: 'cash', name: 'Fandri Wallet', balance: '100000' });
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  // Not shared yet: the Add asset form shows no Shared switch.
  await openNewAsset(page, 'Gold bullion');
  await expect(page.getByTestId('asset-shared-switch')).toHaveCount(0);

  // The setup: filing, the Shared row (all on), and a list that searches and switches before anything is sent.
  const section = await netWorthSection(page);
  await expect(section.getByTestId('networth-shared-row')).toContainText('All 2');
  await section.getByTestId('filing-separate').click();
  await section.getByTestId('networth-shared-row').click();
  await expect(page).toHaveURL(/\/share\/net-worth\/items$/);
  const switches = page.getByTestId('networth-item-switch');
  await expect(switches).toHaveCount(2);
  await page.getByTestId('networth-items-search').fill('wall');
  await expect(switches).toHaveCount(1);
  await page.getByTestId('networth-items-search').fill('zzz');
  await expect(switches).toHaveCount(0);
  await page.getByTestId('networth-items-search').fill('WALLET');
  await expect(switches).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: 'Fandri Wallet' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Fandri Wallet' }).click({ force: true });
  await expect(page.getByRole('checkbox', { name: 'Fandri Wallet' })).not.toBeChecked();
  await page.goBack();
  // The filing answer survived the trip to the list.
  await expect(section.getByTestId('networth-shared-row')).toContainText('1 of 2');
  await section.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(section.getByTestId('net-worth-waiting')).toContainText('Waiting for Dewi', { timeout: 30_000 });

  // Dewi confirms; each reviews once. What was switched off stays off in Fandri's review.
  const theirs = await netWorthSection(dewi);
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-asked')).toContainText('Fandri asks to share net worth', { timeout: 1_000 }));
  await theirs.getByRole('button', { name: 'Confirm', exact: true }).click();
  await eventually(dewi, () => expect(theirs.getByTestId('net-worth-status')).toContainText('Shared with Fandri', { timeout: 1_000 }));
  await reviewAndShare(dewi, info, 'nw-list-dewi');
  await openWorkspaceSharePage(page, 'Home');
  await openNetWorthPage(page);
  await page.getByTestId('networth-shared-row').click();
  await expect(page.getByTestId('net-worth-review')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Fandri Wallet' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Fandri Bank' })).toBeChecked();
  await page.getByTestId('net-worth-share').click();
  await expect(page.getByTestId('net-worth-review')).toHaveCount(0, { timeout: 30_000 });

  // Active: the switches save at once, and the Net worth page reads N of M.
  await page.getByRole('checkbox', { name: 'Fandri Wallet' }).click({ force: true });
  await expect(page.getByRole('checkbox', { name: 'Fandri Wallet' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Fandri Wallet' }).click({ force: true });
  await expect(page.getByRole('checkbox', { name: 'Fandri Wallet' })).not.toBeChecked();
  await page.goBack();
  await expect(page.getByTestId('net-worth-filing')).toContainText('Filed separately');
  await expect(page.getByTestId('networth-shared-row')).toContainText('1 of 2');

  // A new asset starts Shared while sharing is active; the switch off makes it private.
  await openNewAsset(page, 'Gold bullion');
  await expect(page.getByTestId('asset-shared-switch')).toBeChecked();
  await page.getByLabel('Name', { exact: true }).fill('Shared gold');
  await fillDay(page, 'Bought', '2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('13100000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Private gold');
  await page.getByTestId('asset-shared-switch').click({ force: true });
  await expect(page.getByTestId('asset-shared-switch')).not.toBeChecked();
  await fillDay(page, 'Bought', '2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('13100000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  await openWorkspaceSharePage(page, 'Home');
  await openNetWorthPage(page);
  await expect(page.getByTestId('networth-shared-row')).toContainText('2 of 4');
  await page.getByTestId('networth-shared-row').click();
  await expect(page.getByRole('checkbox', { name: 'Shared gold' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Private gold' })).not.toBeChecked();
  await shot(page, info, 'nw-list-active');
});
