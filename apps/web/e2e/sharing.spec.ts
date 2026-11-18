import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Browser, expect, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import { openRowPeek, receiptPeek } from './receipt-peek';
import { currencyRow, setCurrency } from './currency-field';
import BetterSqlite3 from 'better-sqlite3';
import { openAccount, openAccountHistory, openCard, walletCard, openFace, wideScreen } from './accounts';
import { fillDay, openNewAsset, pastPurchase } from './add-asset';
import { addForm, addTransaction, addTransfer, fillAmount, openAmount, saveButton } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';
import { openDrawers } from './drawers';
import { openWithPockets } from './pockets';
import { pickView } from './wallet';
import { openMemberPage, openSharePage, openWorkspacePage, openWorkspaceSharePage, putOffShareList, renameWorkspace, shareWorkspace } from './workspace-page';

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

/** A purchase's receipt: the row's tap on a phone (its page); a click on the row on a wide screen (the Mac receipt, its peek). */
async function openReceipt(page: Page, phone: boolean, description: string) {
  await page.goto('/transactions');
  if (!phone) {
    await openRowPeek(page, description);
    return;
  }
  // The row's face, not the category circle beside it (whose name is "Category for …").
  await rowOf(page, description).getByRole('button', { name: new RegExp(`^(?!Category for).*${description}`) }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
}

/** The receipt's Edit: the round button on the phone's page, the peek's Edit on a wide screen. */
const editOf = (page: Page, phone: boolean) => (phone ? page.getByRole('button', { name: 'Edit this transaction' }) : receiptPeek(page).getByRole('button', { name: 'Edit', exact: true }));

/** Corrects what a purchase came to, from its receipt: the phone's Add screen on it, the wide screen's full edit screen. */
async function correct(page: Page, phone: boolean, description: string, amount: string) {
  await openReceipt(page, phone, description);
  await editOf(page, phone).click();
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
    const sheet = page.getByRole('form', { name: 'Edit a transaction' });
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
  await page.getByRole('button', { name: 'About Name shown' }).click();
  await expect(page.getByRole('form', { name: 'Share this workspace' })).toContainText('A replaced or restored phone needs a new invite.');
  const code = await shareWorkspace(page, 'Fandri');
  expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await expect(page.getByTestId('invite-link')).toHaveText(`cicis://join/${code}`);
  await expect(page.getByTestId('sharing-sync-row')).toContainText('Up to date');
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
  await putOffShareList(page);

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
  await openMemberPage(dewi, 'This phone');
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
  await eventually(dewi, async () => expect(await shareStatus(dewi)).toContainText('Removed from this workspace', { timeout: 1_000 }));
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
  await setCurrency(currencyRow(sheet, 'Reads in'), 'SGD');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);

  await openWorkspaceSharePage(page, 'Singapore');
  await expect(page.getByText("This workspace keeps its money in SGD; this app's own accounts are kept in IDR. Sharing across currencies isn't supported yet.")).toBeVisible();
  await expect(page.getByTestId('share-button')).toHaveCount(0);
  await shot(page, info, '7-currency-refusal');
});

/** Fandri shares a workspace called Home and Dewi joins it: the start of every edge below. */
async function shareAndJoin(page: Page, dewi: Page, names: { owner: string; joiner: string } = { owner: 'Fandri', joiner: 'Dewi' }) {
  await openWorkspaceSettings(page, 'Personal');
  await renameWorkspace(page, 'Home');
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await openSharePage(page);
  const code = await shareWorkspace(page, names.owner);
  await dewi.goto(`/join#${code}`);
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill(names.joiner);
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(page);
}

/** Settings → Home, then the destructive row and its confirmation sheet's ✓. */
async function confirmDestructive(page: Page, row: string, sheet: string, confirm: string, tapRow = true) {
  if (tapRow) await page.getByRole('button', { name: row, exact: true }).click();
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

  // Fandri is the only owner: no Leave, only Stop sharing (redesign A1: the way out, last and alone).
  await openWorkspaceSharePage(page, 'Home');
  await eventually(page, () => expect(page.getByTestId('sharing-member')).toHaveCount(2, { timeout: 1_000 }));
  await expect(page.getByRole('button', { name: 'Leave Home', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop sharing Home', exact: true })).toBeVisible();
  await shot(page, info, '8-last-owner-refused');

  // Make owner, on Dewi's page: she becomes one, and can invite.
  await openMemberPage(page, 'Dewi');
  await page.getByRole('button', { name: 'Make Dewi an owner' }).click();
  await expect(page.getByTestId('member-page')).toContainText('Owner');
  await expect(page.getByRole('button', { name: 'Make Dewi an owner' })).toHaveCount(0);
  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-member').filter({ hasText: 'This phone' })).toContainText('Owner', { timeout: 1_000 }));
  await openMemberPage(dewi, 'This phone');
  await dewi.getByRole('button', { name: 'Invite someone' }).click();
  await expect(dewi.getByTestId('invite-code')).toHaveText(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/, { timeout: 30_000 });

  // Now Fandri may leave: the book stays on Fandri's device, read-only.
  await openWorkspaceSharePage(page, 'Home');
  await confirmDestructive(page, 'Leave Home', 'Leave this workspace?', 'Leave');
  await expect(await shareStatus(page)).toContainText('Left this workspace', { timeout: 30_000 });
  await expectReadOnly(page, phone, 'Left this workspace');
  await shot(page, info, '9-left-read-only');

  // Dewi sees Fandri gone.
  await openWorkspaceSharePage(dewi, 'Home');
  await openMemberPage(dewi, 'This phone');
  await expect(dewi.getByTestId('sharing-device')).toHaveCount(1);
  await dewi.goBack();
  await openMemberPage(dewi, 'Fandri');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-device')).toHaveCount(0, { timeout: 1_000 }));
});

test('a member renames herself from her own page; the owner sees the new name, and cannot rename her (D-D2)', async ({ page, browser }, info) => {
  const dewi = await secondDevice(browser, info);
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  // Dewi's own page carries a Name row; its sheet is prefilled, Save is off for blank or unchanged.
  await openWorkspaceSharePage(dewi, 'Home');
  await openMemberPage(dewi, 'This phone');
  const nameRow = dewi.getByTestId('member-name-row');
  await expect(nameRow).toContainText('Dewi');
  await nameRow.click();
  const sheet = dewi.getByRole('dialog', { name: 'Name' });
  const field = sheet.getByLabel('Name', { exact: true });
  await expect(field).toHaveValue('Dewi');
  const save = sheet.getByTestId('member-name-save');
  await expect(save).toBeDisabled();
  await field.fill('   ');
  await expect(save).toBeDisabled();
  await field.fill('x'.repeat(41));
  await expect(sheet).toContainText('At most 40 characters.');
  await expect(save).toBeDisabled();
  await field.fill('  Dewi Ratna  ');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(sheet).toHaveCount(0);
  await expect(dewi.getByTestId('member-name-row')).toContainText('Dewi Ratna');
  await expect(dewi.getByRole('heading', { name: 'Dewi Ratna' }).first()).toBeVisible();
  await shot(dewi, info, 'rename-self');
  await dewi.goBack();
  await expect(dewi.getByTestId('sharing-member').filter({ hasText: 'Dewi Ratna' }).filter({ hasText: 'This phone' })).toBeVisible();

  // Fandri sees it after a sync; on Dewi's page there is no Name row for him, on his own there is.
  await openWorkspaceSharePage(page, 'Home');
  await eventually(page, () => expect(page.getByTestId('sharing-member').filter({ hasText: 'Dewi Ratna' })).toHaveCount(1, { timeout: 1_000 }));
  await openMemberPage(page, 'Dewi Ratna');
  await expect(page.getByTestId('member-name-row')).toHaveCount(0);
  await page.goBack();
  await openMemberPage(page, 'This phone');
  await expect(page.getByTestId('member-name-row')).toContainText('Fandri');
});

test('an owner stops sharing: the other side says who stopped it, and can add nothing', async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  await openWorkspaceSharePage(page, 'Home');
  await confirmDestructive(page, 'Stop sharing Home', 'Stop sharing?', 'Stop sharing');
  // On the owner's own device it is an ordinary workspace again, which could be shared anew.
  await expect(page.getByTestId('ws-share-row')).toContainText('Off', { timeout: 30_000 });

  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, async () => expect(await shareStatus(dewi)).toContainText('No longer shared by Fandri', { timeout: 1_000 }));
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
  await confirmDestructive(page, 'Stop sharing Home', 'Stop sharing?', 'Stop sharing');
  await expect(page.getByTestId('ws-share-row')).toContainText('Off', { timeout: 30_000 });
  await openWorkspaceSharePage(dewi, 'Home');
  await eventually(dewi, async () => expect(await shareStatus(dewi)).toContainText('No longer shared by Fandri', { timeout: 1_000 }));
  await expectReadOnly(dewi, phone, 'No longer shared by Fandri');

  // Fandri shares it again, as the same person: the members are Fandri and the remembered Dewi, nobody twice.
  await openWorkspacePage(page, 'Home');
  await openSharePage(page);
  // The name is remembered from last time.
  await expect(page.getByTestId('share-name')).toHaveValue('Fandri');
  const first = await shareWorkspace(page, 'Fandri');
  const section = page.getByTestId('sharing-section');
  await expect(section.getByTestId('sharing-member')).toHaveCount(2);
  await expect(section.getByTestId('sharing-member').filter({ hasText: 'This phone' })).toContainText('Owner');
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
  await eventually(dewi, async () => expect(await shareStatus(dewi)).toContainText('Up to date', { timeout: 1_000 }));
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

/** A switch by its label, turned to `on` (and left as it is when it already is). */
async function setSwitch(page: Page, label: string, on: boolean) {
  const toggle = page.getByRole('checkbox', { name: label, exact: true });
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.isChecked()) !== on) await toggle.click({ force: true });
}

/**
 * An account's "Shared with <partner>" switch, on its Settings (2026-11-13). The first item shared starts the
 * household's net worth, filed separately; the other phone confirms by itself.
 */
async function shareAccount(page: Page, name: string, partner: string) {
  await page.goto('/wallet');
  await openFace(walletCard(page, name));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await setSwitch(page, `Shared with ${partner}`, true);
  await expect(page.getByRole('checkbox', { name: `Shared with ${partner}`, exact: true })).toBeChecked();
}

/** The Tax report's Household group, once this phone is in a net-worth group (or asked to be). */
async function householdFiling(page: Page) {
  const filing = page.getByTestId('household-filing');
  await eventually(page, async () => {
    await page.goto('/tax-report');
    await expect(filing).toBeVisible({ timeout: 2_000 });
  });
  return filing;
}

/** The filing changed in the Tax report (its question is accepted by the test's dialog handler). */
async function fileAs(page: Page, mode: 'joint' | 'separate') {
  const filing = await householdFiling(page);
  await eventually(page, () => expect(filing.getByLabel('Filing')).toBeEnabled({ timeout: 1_000 }));
  await filing.getByLabel('Filing').selectOption(mode);
  await expect(filing.getByTestId('filing-waiting')).toBeVisible({ timeout: 30_000 });
}

/** One tax ID asked of this phone, confirmed in its Tax report. */
async function confirmFiling(page: Page, info: TestInfo, name: string) {
  const filing = page.getByTestId('household-filing');
  await eventually(page, async () => {
    await page.goto('/tax-report');
    await expect(filing.getByTestId('filing-asked')).toBeVisible({ timeout: 2_000 });
  });
  await shot(page, info, name);
  await filing.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(filing.getByTestId('filing-asked')).toHaveCount(0, { timeout: 30_000 });
}

/** The filing as this phone reads it. */
async function filingReads(page: Page, mode: 'joint' | 'separate') {
  await eventually(page, async () => {
    await page.goto('/tax-report');
    await expect(page.getByTestId('household-filing').getByLabel('Filing')).toHaveValue(mode, { timeout: 2_000 });
  });
}

/**
 * The household files with one tax ID, the 2026-11-13 way: Fandri shares his bank account (net worth starts, filed
 * separately, Dewi's phone confirming by itself), then asks for one tax ID in the Tax report and Dewi confirms there.
 * Nobody reviews: one tax ID shares every item, which each agreed to.
 */
async function filesTogether(page: Page, dewi: Page, info: TestInfo, prefix: string) {
  await shareAccount(page, 'Fandri Bank', 'Dewi');
  await householdFiling(dewi);
  await fileAs(page, 'joint');
  await shot(page, info, `${prefix}-filing-asked`);
  await confirmFiling(dewi, info, `${prefix}-filing-confirm`);
  await filingReads(page, 'joint');
  // One tax ID shares every item: each person says so with a tap of their own (review round 1).
  await reviewInList(dewi, info, `${prefix}-review`);
  await reviewInList(page, info, `${prefix}-review`);
}

/** A review this person has yet to answer, answered with their own tap: Share › Shared with › "Share what is switched on". */
async function reviewInList(page: Page, info: TestInfo, name: string) {
  await eventually(page, async () => {
    await page.goto('/tax-report');
    await expect(page.getByTestId('filing-review')).toBeVisible({ timeout: 2_000 });
  });
  await page.getByTestId('filing-review').click();
  const answer = page.getByTestId('share-list-review-answer');
  await expect(answer).toBeVisible({ timeout: 30_000 });
  await shot(page, info, name);
  await answer.click();
  await expect(page).toHaveURL(/\/share$/, { timeout: 60_000 });
}

/** The status in words: on Sync details since the Share page's redesign (A1), one tap from its Sync row. */
async function shareStatus(page: Page) {
  if (!/\/share\/details$/.test(page.url())) await page.getByTestId('sharing-sync-row').click();
  return page.getByTestId('sync-details-status');
}

/** Net worth's figure. Each person's part is not shown under it (removed 2026-11-12); `_parts` keeps the callers' record. */
async function netWorthReads(page: Page, figure: string, _parts: string[] | null) {
  await page.goto('/net-worth');
  await eventually(page, async () => {
    await expect(page.getByTestId('net-worth')).toContainText(figure, { timeout: 1_000 });
    await expect(page.getByTestId('owner-legend')).toHaveCount(0, { timeout: 1_000 });
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
  await openFace(page.getByRole('link', { name: 'Fandri Card' }));
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  // Fandri shares his bank account, then asks for one tax ID in the Tax report; Dewi confirms there, told what goes.
  await filesTogether(page, dewi, info, '13');

  // Both read the household's figure — 10 jt + 5 jt — and whose part is whose.
  await netWorthReads(page, '15.000.000', ['Fandri', '10 jt', 'Dewi', '5 jt']);
  await shot(page, info, '16-net-worth-joint');
  await netWorthReads(dewi, '15.000.000', ['Fandri', '10 jt', 'Dewi', '5 jt']);
  await shot(dewi, info, '16-net-worth-joint');

  // Every row of the household's sheet is ringed in its owner's colour, one's own too — by their place in the group
  // while nobody has picked one: blue for Fandri, who set it up, purple for Dewi. The same on both phones.
  const BLUE = 'var(--owner-blue)';
  const PURPLE = 'var(--owner-purple)';
  const TEAL = 'var(--owner-teal)';
  const ringOf = (row: Locator) => row.locator('[data-ring]');
  await openDrawers(dewi);
  const sheetRow = (p: Page, name: string) => p.locator('[data-testid^="sheet-row-"]').filter({ hasText: name });
  await expect(ringOf(sheetRow(dewi, 'Fandri Bank'))).toHaveAttribute('data-ring', BLUE);
  await expect(ringOf(sheetRow(dewi, 'Dewi Bank'))).toHaveAttribute('data-ring', PURPLE);
  await openDrawers(page);
  await expect(ringOf(sheetRow(page, 'Fandri Bank'))).toHaveAttribute('data-ring', BLUE);
  await expect(ringOf(sheetRow(page, 'Dewi Bank'))).toHaveAttribute('data-ring', PURPLE);

  // Dewi picks her own ring colour on her member page: teal, saved on tap. Fandri's blue is his, and cannot be picked.
  await openWorkspaceSharePage(dewi, 'Home');
  await openMemberPage(dewi, 'This phone');
  const ringRow = dewi.getByTestId('ring-colour-row');
  await expect(ringRow).toContainText('Purple');
  await expect(dewi.getByTestId('member-page')).toContainText('The ring round each of Dewi’s accounts on Net worth, Assets and Liabilities, the same on every phone in the household.');
  await ringRow.click();
  const ringSheet = dewi.getByRole('dialog', { name: 'Ring colour' });
  await expect(ringSheet.getByTestId('ring-option-blue')).toBeDisabled();
  await expect(ringSheet.getByTestId('ring-option-blue')).toContainText('Fandri’s');
  await expect(ringSheet).toContainText('Fandri’s colour is taken, so two people never share one.');
  await shot(dewi, info, '16d-ring-colour');
  await ringSheet.getByTestId('ring-option-teal').click();
  await expect(ringSheet).toHaveCount(0);
  await expect(ringRow).toContainText('Teal');
  // Her rows are teal on her phone straight away, and on Fandri's once it has synced.
  await dewi.goto('/net-worth');
  await openDrawers(dewi);
  await expect(ringOf(sheetRow(dewi, 'Dewi Bank'))).toHaveAttribute('data-ring', TEAL);
  await eventually(page, async () => {
    await page.goto('/net-worth');
    await openDrawers(page);
    await expect(ringOf(sheetRow(page, 'Dewi Bank'))).toHaveAttribute('data-ring', TEAL, { timeout: 1_000 });
  });

  // Dewi's own account page, opened from the household's sheet, wears her ring on its hero.
  await sheetRow(dewi, 'Dewi Bank').click();
  await expect(dewi.getByTestId('balance-card').getByTestId('card-currency')).toHaveAttribute('data-ring', TEAL);
  await dewi.goto('/net-worth');
  await openDrawers(dewi);

  // Fandri's shared account opens the account page's layout on Dewi's phone, read-only: the hero with his ring, whose
  // it is and when it was updated in its line, Recent with the one locked other-use total, and no Spend or Edit.
  await dewi.getByRole('link', { name: /^Fandri's Fandri Bank, / }).click();
  await expect(dewi).toHaveURL(/\/net-worth\/shared\//);
  await expect(dewi.getByRole('heading', { name: 'Fandri Bank' })).toBeVisible();
  await expect(dewi.getByTestId('shared-item-hero')).toContainText('10.000.000');
  await expect(ringOf(dewi.getByTestId('shared-item-mark'))).toHaveAttribute('data-ring', BLUE);
  await expect(dewi.getByTestId('shared-item-line')).toContainText('Fandri’s · Current account · updated');
  await expect(dewi.getByTestId('shared-item-recent').getByTestId('other-use')).toContainText('Fandri');
  await expect(dewi.getByTestId('shared-item-recent').getByTestId('other-use')).toContainText('total only');
  await expect(dewi.getByRole('button', { name: 'Spend' })).toHaveCount(0);
  await shot(dewi, info, '16b-partner-item');

  // The household's Assets page counts both people: one total, one square per kind, one list mixing both — on both phones.
  for (const phone of [dewi, page]) {
    await eventually(phone, async () => {
      await phone.goto('/net-worth/assets');
      await expect(phone.getByTestId('assets-total')).toContainText('15.000.000', { timeout: 2_000 });
      await expect(phone.getByTestId('assets-household')).toContainText('Household · ', { timeout: 2_000 });
    });
    await expect(phone.getByTestId('assets-household')).toContainText('Fandri');
    await expect(phone.getByTestId('assets-household')).toContainText('Dewi');
    await expect(phone.getByText('Shared by Fandri', { exact: true })).toHaveCount(0);
    await openDrawers(phone);
  }
  await expect(ringOf(dewi.locator('[data-testid^="assets-shared-"]').filter({ hasText: 'Fandri Bank' }))).toHaveAttribute('data-ring', BLUE);
  await expect(ringOf(page.locator('[data-testid^="assets-shared-"]').filter({ hasText: 'Dewi Bank' }))).toHaveAttribute('data-ring', TEAL);
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
  await openFace(page.getByRole('link', { name: 'Fandri Card' }));
  await cardPage(page, 'Statement');
  await eventually(page, () => expect(page.getByTestId('statement-line').filter({ hasText: 'Dewi dinner' })).toContainText('200.000', { timeout: 1_000 }));
  await shot(page, info, '17-card-statement');

  // Fandri sends Dewi 5 jt, to her shared account: his goes down, hers goes up.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const transfer = addForm(page);
  await transfer.getByRole('radio', { name: 'Transfer', exact: true }).click();
  // To first, with From still empty (owner's report, build 122/123): Dewi's shared account is listed all the same.
  await transfer.getByRole('button', { name: /^To/ }).click();
  const to = page.getByRole('dialog', { name: 'To', exact: true });
  // To is the same sheet as From and Paid with: a partner's row is named with whose it is, as Paid with names it.
  await to.getByRole('region', { name: 'Dewi’s, shared with Home' }).getByRole('button', { name: 'Dewi Bank, Dewi’s, shared with Home', exact: true }).click();
  await transfer.getByRole('button', { name: /^From/ }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'Fandri Bank', exact: true }).click();
  await expect(transfer.getByRole('button', { name: /^To/ })).toContainText('Dewi Bank');
  await openAmount(transfer);
  await fillAmount(page, transfer, '5000000');
  await transfer.getByLabel('Note').fill('For the house');
  await shot(page, info, '18-transfer-to-partner');
  await saveButton(transfer).click();
  await expect(transfer).toHaveCount(0);
  await accountReads(page, 'Fandri Bank', '5.000.000');
  await accountReads(dewi, 'Dewi Bank', '10.000.000');
  // The household's figure is what it was, less the dinner on the card: 15 jt − 200.000.
  await netWorthReads(page, '14.800.000', ['Fandri', 'Dewi']);
  await netWorthReads(dewi, '14.800.000', ['Fandri', 'Dewi']);

  // The household's Liabilities page lists Fandri's card on both phones, ringed blue; on Dewi's it opens his page.
  for (const phone of [dewi, page]) {
    await eventually(phone, async () => {
      await phone.goto('/net-worth/loans');
      await expect(phone.getByTestId('debts-total')).toContainText('200.000', { timeout: 2_000 });
    });
    await expect(phone.getByTestId('debts-household')).toContainText('Household · ');
    await openDrawers(phone);
    await expect(ringOf(phone.locator('[data-testid^="debt-row-"]').filter({ hasText: 'Fandri Card' }))).toHaveAttribute('data-ring', BLUE);
  }
  await dewi.locator('[data-testid^="debt-row-"]').filter({ hasText: 'Fandri Card' }).click();
  await expect(dewi).toHaveURL(/\/net-worth\/shared\//);
  await expect(dewi.getByTestId('shared-item-hero')).toContainText('Owed');
  await expect(dewi.getByTestId('shared-item-recent')).toContainText('Dewi dinner');
  await expect(dewi.getByTestId('shared-item-recent')).toContainText('Household');
  await shot(dewi, info, '18b-partner-card');

  // Fandri changes to separate tax IDs in the Tax report; Dewi confirms it there — a change is never confirmed for her.
  await fileAs(page, 'separate');
  await confirmFiling(dewi, info, '19-filing-separate');
  await filingReads(dewi, 'separate');
  await filingReads(page, 'separate');

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
  await openFace(walletCard(page, 'Fandri Bank'));
  // Household sharing sits in the account's Settings.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await setSwitch(page, 'Shared with Dewi', false);
  await expect(page.getByRole('checkbox', { name: 'Shared with Dewi', exact: true })).not.toBeChecked();
  await eventually(dewi, async () => {
    await dewi.goto('/wallet');
    await expect(sharedRows.filter({ hasText: 'Fandri Card' })).toHaveCount(1, { timeout: 2_000 });
    await expect(sharedRows.filter({ hasText: 'Fandri Bank' })).toHaveCount(0, { timeout: 2_000 });
  });

  // Dewi leaves: her Net worth is her own again, and nothing of Fandri's is listed.
  await householdFiling(dewi);
  await confirmDestructive(dewi, 'Stop sharing net worth', 'Stop sharing net worth?', 'Stop sharing');
  await expect(dewi.getByTestId('household-filing')).toHaveCount(0, { timeout: 30_000 });
  await netWorthReads(dewi, '10.000.000', null);
  await dewi.goto('/wallet');
  await expect(dewi.getByText('Dewi Bank').first()).toBeVisible();
  await expect(sharedRows).toHaveCount(0);
  await shot(dewi, info, '21-left-personal');
});


test('a transfer in a shared workspace is in neither Cashflow, never names its accounts to the partner, and is deleted from its account', async ({ page, browser }, info) => {
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
  await putOffShareList(page);

  // Fandri moves money between his own accounts in the shared workspace, then buys something: the purchase is the sign
  // that his changes have reached Dewi.
  await page.goto('/transactions');
  await addTransfer(page, { from: 'Fandri Bank', to: 'Fandri Pocket', amount: '250000', note: 'Pocket money' });
  await addTransaction(page, { description: 'Fandri snack', paidWith: 'Fandri Bank', category: 'Groceries', amount: '15000' });
  // Cashflow lists only money in and out (owner 2026-11-16): not on his own list, even in the shared workspace.
  await expect(rowOf(page, 'Fandri snack')).toBeVisible();
  await expect(rowOf(page, 'Pocket money')).toHaveCount(0);
  await expect(page.getByTestId('shared-transfer-row')).toHaveCount(0);
  // Nor on Dewi's, as a redacted row or any other way; and no name of the pocket reaches her.
  await eventually(dewi, async () => {
    await dewi.goto('/transactions');
    await expect(rowOf(dewi, 'Fandri snack')).toHaveCount(1, { timeout: 1_000 });
  });
  await expect(dewi.getByTestId('shared-transfer-row')).toHaveCount(0);
  await expect(dewi.locator('main')).not.toContainText('Pocket money');
  await expect(dewi.locator('main')).not.toContainText('Fandri Pocket');

  // His bank's history lists it, and deletes it.
  await openAccountHistory(page, 'Fandri Bank');
  await page.locator('li', { hasText: /Pocket money/ }).first().click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await expect(page.locator('li', { hasText: /Pocket money/ })).toHaveCount(0);
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

  await filesTogether(page, dewi, info, 'j1');

  // Fandri's account Settings: Owned together sits under Shared with Dewi, off.
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Fandri Bank'));
  await expect(page.getByTestId('joint-row')).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Shared with Dewi', exact: true })).toBeChecked();
  const joint = page.getByRole('checkbox', { name: 'Owned together' });
  await expect(joint).not.toBeChecked();
  await joint.scrollIntoViewIfNeeded();
  await joint.click({ force: true });
  await expect(joint).toBeChecked();
  await shot(page, info, 'j2-switch-on');
  await page.goBack();

  // Dewi's Paid with lists it with the Joint tag, and she pays from it.
  const paidWithJoint = dewi.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Fandri Bank, Fandri’s, shared', exact: true });
  await eventually(dewi, async () => {
    await dewi.goto('/transactions');
    await dewi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
    await addForm(dewi).getByRole('button', { name: /^Paid with/ }).click();
    await expect(paidWithJoint).toContainText('owned together', { timeout: 1_000 });
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
    await openFace(walletCard(page, 'Fandri Bank'));
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
  await expect(editOf(page, phoneProject(info))).toBeVisible();
  await expect(page.getByTestId('joint-note')).toContainText('by Dewi');
  await openReceipt(dewi, phoneProject(info), 'Fandri water');
  await expect(editOf(dewi, phoneProject(info))).toBeVisible();

  // Fandri deletes Dewi's row: it stays on both lists as deleted, with who deleted it, and either can restore it.
  await openReceipt(page, phoneProject(info), 'Dewi groceries');
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  // A wide screen's peek closes once the delete is written, on Cashflow still; a phone's receipt goes back to the list.
  if (!phoneProject(info)) await expect(receiptPeek(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/transactions$/);
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Fandri Bank'));
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
    await openFace(walletCard(page, 'Fandri Bank'));
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
  // From first, with To still empty (owner's report, build 122/123): Fandri's joint account is listed all the same.
  await withdrawal.getByRole('button', { name: /^From/ }).click();
  const fromSheet = dewi.getByRole('dialog', { name: 'From', exact: true });
  await fromSheet.getByRole('region', { name: /^Fandri’s, shared with/ }).getByRole('button', { name: /^Fandri Bank, Fandri’s, shared/ }).click();
  await withdrawal.getByRole('button', { name: /^To/ }).click();
  await dewi.getByRole('dialog', { name: 'To', exact: true }).getByRole('button', { name: 'Dewi Cash' }).first().click();
  await expect(withdrawal.getByRole('button', { name: /^From/ })).toContainText('Fandri Bank');
  await openAmount(withdrawal);
  await fillAmount(dewi, withdrawal, '300000');
  await withdrawal.getByLabel('Note').fill('Cash withdrawal');
  await saveButton(withdrawal).click();
  await expect(withdrawal).toHaveCount(0);
  await accountReads(page, 'Fandri Bank', '9.470.000');
  await eventually(page, async () => {
    await page.goto('/wallet');
    await openFace(walletCard(page, 'Fandri Bank'));
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
  await openFace(walletCard(page, 'Fandri Bank'));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Owned together' }).scrollIntoViewIfNeeded();
  await page.getByRole('checkbox', { name: 'Owned together' }).click({ force: true });
  // Off asks first (mockup ③).
  await confirmDestructive(page, '', 'Stop owning Fandri Bank together?', 'Stop', false);
  await expect(page.getByRole('checkbox', { name: 'Owned together' })).not.toBeChecked();
  await page.goBack();
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
 * The partner's joint account and joint card in Wallet (owner, 12 Nov; mockups 2026-11-12-wallet-joint-items A and
 * -marks option 4). Rina shares a saving account, a credit card and her cash, separate tax IDs, and turns Joint on for
 * the first two: on Andi's phone they are cards in Wallet with "· Rina’s" after the type, they count in his Balance and
 * its rows filter to them, they leave the "Rina's, shared" list (her cash stays there), and a tap opens the item's page,
 * whose Add records a purchase on her card in the shared workspace.
 */
test('the partner’s joint account and joint card are cards in Wallet, counted in Balance, and open their own page', async ({ page, browser }, info) => {
  test.setTimeout(900_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const andi = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'savings', name: 'Joint savings', balance: '8000000' });
  await openAccount(page, { subtype: 'cash', name: 'Rina Cash', balance: '100000' });
  await openCard(page, { name: 'Rina Card', last4: '5678', owed: '850000' });
  await openAccount(andi, { subtype: 'bank', name: 'Andi Payroll', balance: '4300000' });
  await page.goto('/transactions');
  await shareAndJoin(page, andi, { owner: 'Rina', joiner: 'Andi' });

  // Rina switches all three on in Share › Shared with Andi: net worth starts, filed separately; Andi's phone confirms by itself.
  await openWorkspaceSharePage(page, 'Home');
  await page.getByTestId('share-list-row').click();
  for (const name of ['Joint savings', 'Rina Cash', 'Rina Card']) await setSwitch(page, name, true);
  await shot(page, info, 'wj1-review');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/share$/, { timeout: 60_000 });

  // Shared but not joint yet: nothing of Rina's is a card on Andi's Wallet; all three are in "Rina's, shared".
  const sharedRows = andi.locator('[data-testid^="shared-item-"]');
  await eventually(andi, async () => {
    // Rina's phone sends once its review is in (by itself, after Andi's phone confirmed): brought to the front here.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await andi.goto('/wallet');
    await expect(andi.getByText("Rina's, shared")).toBeVisible({ timeout: 1_000 });
    await expect(sharedRows).toHaveCount(3, { timeout: 1_000 });
  });
  await expect(walletCard(andi, 'Joint savings')).toHaveCount(0);

  // Rina turns Joint account on for the savings and Joint card on for the card.
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Joint savings'));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await setSwitch(page, 'Owned together', true);
  await expect(page.getByRole('checkbox', { name: 'Owned together' })).toBeChecked();
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Rina Card'));
  await cardPage(page, 'Settings');
  await setSwitch(page, 'Owned together', true);
  await expect(page.getByRole('checkbox', { name: 'Owned together' })).toBeChecked();

  // On Andi's Wallet both are cards, after his own of their kind; only her cash is left in "Rina's, shared".
  await eventually(andi, async () => {
    await andi.goto('/wallet');
    await expect(walletCard(andi, 'Joint savings')).toBeVisible({ timeout: 1_000 });
    await expect(walletCard(andi, 'Rina Card')).toBeVisible({ timeout: 1_000 });
  });
  await expect(walletCard(andi, 'Joint savings')).toHaveAccessibleName('Joint savings, Rina’s, Rp 8.000.000');
  await expect(walletCard(andi, 'Rina Card')).toHaveAccessibleName('Rina Card, Rina’s, Rp 850.000');
  await expect(sharedRows).toHaveCount(1);
  await expect(sharedRows).toContainText('Rina Cash');

  // The grid prints whose each is after its type, in the card's own type line, and the Balance counts both.
  await pickView(andi, 'Grid');
  const grid = andi.getByRole('region', { name: 'Cards' });
  const faces = grid.getByTestId('card-face');
  await expect(faces).toHaveCount(3);
  await expect(faces.nth(0)).toHaveAttribute('aria-label', /^Andi Payroll/);
  await expect(faces.nth(1).getByTestId('card-kind')).toHaveText('Saving account · Rina’s');
  await expect(faces.nth(2).getByTestId('face-type')).toHaveText('Rina Card · Rina’s');
  await expect(andi.getByTestId('wallet-balance')).toContainText('11.450.000');
  await expect(andi.getByTestId('wallet-spending-row')).toContainText('12.300.000');
  await expect(andi.getByTestId('wallet-cards-row')).toContainText('850.000');
  await andi.getByTestId('wallet-spending-row').click();
  await expect(andi.getByTestId('wallet-filter')).toContainText('Spending money · 2');
  await expect(faces).toHaveCount(2);
  await andi.getByTestId('wallet-cards-row').click();
  await expect(andi.getByTestId('wallet-filter')).toContainText('Outstanding on cards · 1');
  await expect(grid).toContainText('Rina Card');
  await shot(andi, info, 'wj2-grid');

  // A tap opens the joint account's page: its balance from Rina's phone, Add and Transfer, Settings greyed, its rows.
  await andi.getByTestId('wallet-cards-row').click();
  await openFace(walletCard(andi, 'Joint savings'));
  await expect(andi).toHaveURL(/\/wallet\/joint\/[^/]+$/);
  await expect(andi.getByTestId('joint-item-hero')).toContainText('8.000.000');
  await expect(andi.getByTestId('joint-item-from')).toContainText('from Rina’s phone');
  await expect(andi.getByTestId('joint-add')).toBeEnabled();
  await expect(andi.getByTestId('joint-transfer')).toBeEnabled();
  await expect(andi.getByTestId('joint-settings')).toBeDisabled();
  await expect(andi.locator('main')).toContainText('Joint account · 0 rows');
  await expect(andi.locator('main')).toContainText('Add and Transfer record in Home. The account’s settings stay on Rina’s phone.');
  await shot(andi, info, 'wj3-joint-account');

  // The joint card's page: Pay and Settings greyed; Add opens the Add screen paying with her card, and the purchase is its row.
  await andi.goto('/wallet');
  await openFace(walletCard(andi, 'Rina Card'));
  await expect(andi.getByTestId('joint-item-hero')).toContainText('Owed');
  await expect(andi.getByTestId('joint-pay')).toBeDisabled();
  await expect(andi.locator('main')).toContainText('Purchases recorded in Home show on both phones. The statement, Pay and points stay on Rina’s phone.');
  await andi.getByTestId('joint-add').click();
  await expect(andi).toHaveURL(/\/transactions\/new/);
  const form = addForm(andi);
  await expect(form.getByRole('button', { name: /^Paid with/ })).toContainText('Rina Card', { timeout: 10_000 });
  await openAmount(form);
  await fillAmount(andi, form, '350000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await andi.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Fuel');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await andi.goto('/wallet');
  await openFace(walletCard(andi, 'Rina Card'));
  await expect(andi.getByTestId('joint-row').filter({ hasText: 'Fuel' })).toContainText('by me');
  await expect(andi.locator('main')).toContainText('Joint card · 1 row');
  await shot(andi, info, 'wj4-joint-card');

  // Reorder cards places her card too: put in front of everything, it stays there once Wallet is read again.
  await andi.goto('/wallet/reorder');
  const reorderRows = andi.getByTestId('reorder-row');
  await expect(reorderRows).toHaveCount(3);
  await expect(reorderRows.nth(2)).toContainText('Rina Card');
  const handle = andi.getByRole('button', { name: 'Reorder Rina Card', exact: true });
  await handle.focus();
  await andi.keyboard.press('ArrowUp');
  await andi.keyboard.press('ArrowUp');
  await expect(reorderRows.nth(0)).toContainText('Rina Card');
  await andi.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(andi).toHaveURL(/\/wallet$/);
  await andi.reload();
  if (wideScreen(andi)) {
    // Mac Wallet keeps each card in its group — hers under Credit cards — in this order; Wallet's order itself is kept.
    await expect(andi.getByTestId('wallet-group-credit').getByTestId('card-face')).toHaveAttribute('aria-label', /^Rina Card/);
    await andi.goto('/wallet/reorder');
    await expect(reorderRows.nth(0)).toContainText('Rina Card');
  } else {
    await expect(faces.nth(0)).toHaveAttribute('aria-label', /^Rina Card/);
    await expect(faces.nth(1)).toHaveAttribute('aria-label', /^Andi Payroll/);
  }
});

/*
 * Net worth from the one list (2026-11-13): before anything is shared the Add asset form shows no Shared switch; the
 * first account switched on in Share › Shared with Dewi starts net worth by itself, and from then a new asset starts
 * Shared (off makes it private). Assets and debts sit behind their own row at the end of the list.
 */
test('net worth sharing from the one list: the first account starts it, a new asset starts Private, and assets sit behind their own row', async ({ page, browser }, info) => {
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

  // The list: one account switched on, Save. Dewi's phone confirms by itself.
  await openWorkspaceSharePage(page, 'Home');
  await page.getByTestId('share-list-row').click();
  await setSwitch(page, 'Fandri Bank', true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/share$/, { timeout: 60_000 });
  await householdFiling(dewi);
  await filingReads(page, 'separate');

  // A new asset starts Private while sharing is active (owner's spec); its switch on shares it.
  await eventually(page, async () => {
    await openNewAsset(page, 'Gold bullion');
    await expect(page.getByTestId('asset-shared-switch')).not.toBeChecked({ timeout: 1_000 });
  });
  await page.getByLabel('Name', { exact: true }).fill('Shared gold');
  await page.getByTestId('asset-shared-switch').click({ force: true });
  await expect(page.getByTestId('asset-shared-switch')).toBeChecked();
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('13100000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Private gold');
  await expect(page.getByTestId('asset-shared-switch')).not.toBeChecked();
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('13100000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  // The list counts it, and the assets are behind their own row.
  await openWorkspaceSharePage(page, 'Home');
  await expect(page.getByTestId('share-list-row')).toContainText('1 account · 1 asset or debt');
  await page.getByTestId('share-list-row').click();
  await expect(page.getByTestId('share-list-assets-row')).toContainText('Assets & debts (2)');
  await page.getByTestId('share-list-assets-row').click();
  await expect(page.getByRole('checkbox', { name: 'Shared gold', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Private gold', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Fandri Wallet', exact: true })).not.toBeChecked();
  await shot(page, info, 'nw-list-active');
});

/*
 * The couple's clean-up, end to end (sharing resilience Task A9, spec §11 in its join-first order). Dewi shares Home and
 * Fandri joins; both record. Her phone then comes back from a copy taken before the share, with Home under a new id
 * (the incident: the test writes the new id into her downloaded copy, the one step no screen can do). She shares again
 * (share 2); Fandri joins beside his first copy, which holds its rows. She stops share 2 and he deletes its empty copy.
 * She records one more purchase and shares a third time, linking a device for Fandri; he joins first, then Leave and
 * delete of his first copy, lands on the new share and taps Place them now: both Cashflow totals are the same.
 */

/** Account's lines for every copy of a workspace called `name`: their book ids, from each line's ›. */
async function copyIds(page: Page, name: string): Promise<string[]> {
  await page.goto('/account');
  await expect(page.getByTestId('account-workspace').first()).toBeVisible();
  const links = page.getByTestId('account-workspace').filter({ hasText: name }).getByTestId('workspace-open');
  const ids: string[] = [];
  for (const href of await links.evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))) ids.push(href.split('/').pop()!);
  return ids;
}

/** Backup → Download backup, kept as a file of its own. */
async function downloadBackup(page: Page, info: TestInfo, name: string): Promise<string> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = join(info.outputDir, `${name}.sqlite3`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, readFileSync((await (await downloaded).path())!));
  return file;
}

/** The workspace called `name` in a downloaded copy, given a new book id everywhere the copy names it. */
function moveBookToNewId(file: string, name: string): { from: string; to: string } {
  const copy = new BetterSqlite3(file);
  try {
    copy.pragma('foreign_keys = OFF');
    const { id: from } = copy.prepare('SELECT id FROM books WHERE name = ?').get(name) as { id: string };
    const to = crypto.randomUUID();
    const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const { name: table } of tables) {
      const columns = copy.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[];
      for (const { name: column } of columns) {
        if (column === 'book_id' || (column.endsWith('_book_id') && column !== 'relay_book_id')) copy.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(to, from);
      }
    }
    copy.prepare('UPDATE books SET id = ? WHERE id = ?').run(to, from);
    copy.prepare('UPDATE settings SET value = ? WHERE value = ?').run(to, from);
    return { from, to };
  } finally {
    copy.close();
  }
}

/** Backup → choose the file → Replace my data with it (a safety copy downloads first); the page reloads. */
async function restoreBackup(page: Page, file: string) {
  await page.goto('/backup');
  const safety = page.waitForEvent('download');
  await page.locator('input[accept*="sqlite3"]').setInputFiles(file);
  await safety;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
}

/** Account → the workspace line's body: it becomes the open one. */
async function switchTo(page: Page, bookId: string) {
  await page.goto('/account');
  const line = page.getByTestId('account-workspace').filter({ has: page.locator(`a[href$="/${bookId}"]`) });
  await line.getByTestId('workspace-switch').click();
  await expect(line.getByTestId('workspace-switch')).toHaveAttribute('aria-current', 'true');
}

/** Cashflow's total for the month on show, as it reads. */
async function total(page: Page): Promise<string> {
  await page.goto('/transactions');
  const figure = page.getByTestId('period-total');
  await expect(figure).toBeVisible();
  return (await figure.textContent())!.trim();
}

test('leave and delete, share again, join: the couple’s clean-up through the screens, both totals equal', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const fandri = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await openAccount(fandri, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });

  // Dewi's Home, with one purchase before any share: the copy her phone will come back to.
  await openWorkspaceSettings(page, 'Personal');
  await renameWorkspace(page, 'Home');
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Dewi before', paidWith: 'Dewi Bank', category: 'Groceries', amount: '20000' });
  await page.goto('/account');
  await expect(page.getByTestId('account-workspace').filter({ hasText: 'Home' })).toHaveCount(1);
  const preShare = await downloadBackup(page, info, 'dewi-before-share');

  // Share 1: Dewi shares, Fandri joins, both record.
  await openWorkspaceSharePage(page, 'Home');
  const code1 = await shareWorkspace(page, 'Dewi');
  await fandri.goto(`/join#${code1}`);
  const join1 = fandri.getByTestId('join-workspace');
  await expect(join1.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join1.getByLabel('Name').fill('Fandri');
  await join1.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join1).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Dewi shared', paidWith: 'Dewi Bank', category: 'Groceries', amount: '15000' });
  await fandri.goto('/transactions');
  await addTransaction(fandri, { description: 'Fandri shared', paidWith: 'Fandri Bank', category: 'Restaurants', amount: '30000' });
  await eventually(fandri, () => expect(rowOf(fandri, 'Dewi shared')).toBeVisible({ timeout: 1_000 }));
  await eventually(page, () => expect(rowOf(page, 'Fandri shared')).toBeVisible({ timeout: 1_000 }));
  const [firstCopy] = await copyIds(fandri, 'Home');
  expect(firstCopy).toBeTruthy();

  // The incident: Dewi's phone comes back from the copy before the share, Home under a new id. Not shared here.
  moveBookToNewId(preShare, 'Home');
  await restoreBackup(page, preShare);
  await openWorkspacePage(page, 'Home');
  await expect(page.getByTestId('ws-share-row')).toContainText('Off');
  await page.goto('/transactions');
  await expect(rowOf(page, 'Dewi before')).toBeVisible();
  await expect(rowOf(page, 'Dewi shared')).toHaveCount(0);

  // Share 2: Fandri joins beside his first copy, warned; the join completes, the rows his first copy holds wait.
  await openWorkspaceSharePage(page, 'Home');
  const code2 = await shareWorkspace(page, 'Dewi');
  await fandri.goto(`/join#${code2}`);
  const join2 = fandri.getByTestId('join-workspace');
  await expect(join2.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(join2.getByTestId('join-other-copies')).toContainText('Another copy of this workspace is on this phone: Home · joined today.');
  await join2.getByLabel('Name').fill('Fandri');
  await join2.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join2).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(page);
  const secondCopy = (await copyIds(fandri, 'Home')).find((id) => id !== firstCopy)!;
  expect(secondCopy).toBeTruthy();

  // Dewi stops share 2; Fandri's copy of it reads so, and he deletes it.
  await openWorkspaceSharePage(page, 'Home');
  await confirmDestructive(page, 'Stop sharing Home', 'Stop sharing?', 'Stop sharing');
  await expect(page.getByTestId('ws-share-row')).toContainText('Off', { timeout: 30_000 });
  await fandri.goto(`/account/workspaces/${secondCopy}/share`);
  await eventually(fandri, async () => expect(await shareStatus(fandri)).toContainText('No longer shared by Dewi', { timeout: 1_000 }));
  await fandri.goto(`/account/workspaces/${secondCopy}`);
  await fandri.getByTestId('delete-workspace').click();
  const deleteSheet = fandri.getByRole('dialog', { name: 'Delete workspace' });
  await expect(deleteSheet.getByTestId('delete-erase-note')).toBeVisible();
  await deleteSheet.getByPlaceholder('Type the workspace’s name').fill('Home');
  await deleteSheet.getByTestId('delete-everything').click();
  await expect(deleteSheet).toHaveCount(0, { timeout: 30_000 });
  expect(await copyIds(fandri, 'Home')).toEqual([firstCopy]);

  // Dewi records one more purchase, on a category his first copy holds, and shares a third time, linking his device.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Dewi new', paidWith: 'Dewi Bank', category: 'Groceries', amount: '5000' });
  await openWorkspaceSharePage(page, 'Home');
  await expect(page.getByTestId('share-name')).toHaveValue('Dewi');
  const first3 = await shareWorkspace(page, 'Dewi');
  await openMemberPage(page, 'Fandri');
  await page.getByRole('button', { name: 'Link a device for Fandri' }).click();
  await expect(page.getByTestId('invite-code')).not.toHaveText(first3, { timeout: 30_000 });
  const code3 = (await page.getByTestId('invite-code').textContent())!.trim();

  // Fandri joins first: the warning names his first copy and the order.
  await fandri.goto(`/join#${code3}`);
  const join3 = fandri.getByTestId('join-workspace');
  await expect(join3.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(join3.getByText('This device joins as Fandri.')).toBeVisible();
  await expect(join3.getByTestId('join-other-copies')).toHaveText(
    'Another copy of this workspace is on this phone: Home · joined today. Join first, then Leave and delete the old copy; its rows come in with Place them now.',
  );
  await shot(fandri, info, 'a9-1-join-warning');
  await join3.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join3).toHaveCount(0, { timeout: 60_000 });
  const newCopy = (await copyIds(fandri, 'Home')).find((id) => id !== firstCopy)!;
  expect(newCopy).toBeTruthy();
  await fandri.goto(`/account/workspaces/${newCopy}`);
  await eventually(fandri, () => expect(fandri.getByTestId('ws-share-lines')).toContainText('Part of this share is held by Home · joined today on this phone.', { timeout: 1_000 }));

  // Then Leave and delete of the first copy: the sheet names it as the one holding the newer share's rows, keep on.
  await fandri.goto(`/account/workspaces/${firstCopy}`);
  await expect(fandri.getByTestId('delete-workspace')).toHaveText('Leave and delete');
  await fandri.getByTestId('delete-workspace').click();
  const leaveSheet = fandri.getByRole('dialog', { name: 'Leave and delete Home · joined today?' });
  await expect(leaveSheet).toBeVisible();
  await expect(leaveSheet.getByTestId('delete-copy-lines')).toContainText('This copy holds rows of the newer share, Home · joined today; deleting it lets them come in.');
  await expect(leaveSheet.getByTestId('delete-keep-own')).toBeChecked();
  await expect(leaveSheet.getByTestId('delete-keep-lines')).toContainText('1 purchase paid from own accounts moves to Personal');
  await shot(fandri, info, 'a9-2-leave-and-delete');
  await leaveSheet.getByRole('button', { name: 'Leave and delete', exact: true }).click();
  await expect(leaveSheet).toHaveCount(0, { timeout: 60_000 });

  // It lands on the new share's page, where Place them now is offered; tapped, the waiting rows come in.
  await expect(fandri).toHaveURL(new RegExp(`/account/workspaces/${newCopy}$`), { timeout: 30_000 });
  await expect(fandri.getByTestId('ws-share-lines')).toContainText('Part of this share is waiting. Place it now.');
  await fandri.getByTestId('ws-place-row').click();
  const placeSheet = fandri.getByRole('dialog', { name: 'Place them now?' });
  await placeSheet.getByRole('button', { name: 'Place them now', exact: true }).click();
  await expect(placeSheet).toHaveCount(0, { timeout: 60_000 });
  await expect(fandri.getByTestId('ws-share-lines')).toContainText(/rows? placed/);
  await expect(fandri.getByTestId('ws-place-row')).toHaveCount(0);
  await shot(fandri, info, 'a9-3-placed');

  // Both phones: the same Home, the same total; his own purchase once, in his Personal.
  expect(await copyIds(fandri, 'Home')).toEqual([newCopy]);
  await switchTo(fandri, newCopy);
  await fandri.goto('/transactions');
  await eventually(fandri, () => expect(rowOf(fandri, 'Dewi before')).toBeVisible({ timeout: 1_000 }));
  await expect(rowOf(fandri, 'Dewi new')).toHaveCount(1);
  await expect(rowOf(fandri, 'Fandri shared')).toHaveCount(0);
  await cashflowTotal(page, 'Rp 25.000');
  await cashflowTotal(fandri, 'Rp 25.000');
  expect(await total(page)).toBe(await total(fandri));
  const shots = join(info.outputDir, 'a9-final');
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${info.project.name}-dewi-cashflow.png`), fullPage: true });
  await fandri.screenshot({ path: join(shots, `${info.project.name}-fandri-cashflow.png`), fullPage: true });
  const [personal] = await copyIds(fandri, 'Personal');
  await switchTo(fandri, personal!);
  await fandri.goto('/transactions');
  await expect(rowOf(fandri, 'Fandri shared')).toHaveCount(1);
  await expect(fandri.getByTestId('period-total')).toHaveText('Rp 30.000');
});

/** Events ＋ offers New event or Join with a code; Join opens the join sheet with a code field. */
test('Events plus offers New event or Join with a code, and Join opens the join sheet', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('button', { name: /^(New event|Add an event)$/ }).click();
  const choices = page.getByTestId('add-event-sheet');
  await expect(choices.getByTestId('new-event')).toBeVisible();
  await choices.getByTestId('join-event-choice').click();
  await expect(choices).toHaveCount(0);
  const join = page.getByTestId('join-workspace');
  await expect(join).toBeVisible();
  await expect(join.getByPlaceholder('XXXX-XXXX-…')).toBeVisible();
});

test('in a joint household every row of Net worth is ringed in its owner’s colour: cash and a bank account with pockets, and gold, too', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await openAccount(page, { subtype: 'bank', name: 'Fandri Bank', balance: '10000000' });
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);
  await filesTogether(page, dewi, info, 'r1');

  // Fandri then opens a Cash with a TRY pocket, a bank account with USD and SGD pockets, and a gold bar in grams.
  await openWithPockets(page, { name: 'Fandri Cash', kind: 'Cash banknotes', pockets: [{ currency: 'IDR', balance: '800000' }, { currency: 'TRY', balance: '1000', rate: '400' }] });
  await openWithPockets(page, {
    name: 'Fandri Valas',
    pockets: [
      { currency: 'USD', balance: '100', rate: '16000' },
      { currency: 'SGD', balance: '100', rate: '12000' },
    ],
  });
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Fandri gold');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('13100000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  const BLUE = 'var(--owner-blue)';
  const PURPLE = 'var(--owner-purple)';
  const ringOf = (row: Locator) => row.locator('[data-ring]');
  const sheetRow = (p: Page, name: string) => p.locator('[data-testid^="sheet-row-"]').filter({ hasText: name });
  await eventually(page, async () => {
    await page.goto('/net-worth');
    await openDrawers(page);
    for (const name of ['Fandri Bank', 'Fandri Cash', 'Fandri Valas', 'Fandri gold']) await expect(ringOf(sheetRow(page, name)).first()).toHaveAttribute('data-ring', BLUE, { timeout: 1_000 });
    await expect(ringOf(sheetRow(page, 'Dewi Bank'))).toHaveAttribute('data-ring', PURPLE, { timeout: 1_000 });
  });
  await shot(page, info, 'r2-every-row-ringed');
  // The Assets page lists the same rows, each ringed too.
  await eventually(page, async () => {
    await page.goto('/net-worth/assets');
    await openDrawers(page);
    for (const name of ['Fandri Bank', 'Fandri Cash', 'Fandri Valas', 'Fandri gold']) {
      const rows = page.locator('a, button').filter({ hasText: name }).filter({ has: page.locator('[data-ring]') });
      await expect(rows.first().locator('[data-ring]').first()).toHaveAttribute('data-ring', BLUE, { timeout: 1_000 });
    }
  });
});
