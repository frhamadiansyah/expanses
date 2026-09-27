import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { openAccount } from './accounts';
import { addTransaction, saveButton } from './add-transaction';

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

/** Settings → Workspaces → the workspace, in the phone's sheet or the desktop's panel. */
async function openWorkspaceSettings(page: Page, name: string) {
  await page.goto('/settings');
  await page.getByTestId('settings-workspace-row').filter({ hasText: name }).click();
}

async function openSwitcher(page: Page, phone: boolean) {
  if (phone) {
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  } else {
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  }
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

/** Corrects what a purchase came to, from its receipt: the phone's edit sheet, the desktop's full card. */
async function correct(page: Page, phone: boolean, description: string, amount: string) {
  await openReceipt(page, phone, description);
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  if (phone) {
    const sheet = page.getByRole('dialog', { name: 'Edit', exact: true });
    await sheet.getByRole('button', { name: 'Amount', exact: true }).click();
    const keypad = page.getByTestId('keypad');
    await keypad.getByRole('button', { name: 'C', exact: true }).click();
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);
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
  await page.getByLabel('Name', { exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Now called Home.')).toBeVisible();

  // Share this workspace: the explainer, a name, then the invite once the history has gone up.
  await page.getByRole('button', { name: /Share this workspace/ }).click();
  const shareForm = page.getByRole('form', { name: 'Share this workspace' });
  await expect(shareForm).toContainText('A replaced or restored phone needs a new invite.');
  await shareForm.getByLabel('Your name').fill('Fandri');
  await shareForm.getByRole('button', { name: 'Share', exact: true }).click();
  const code = (await page.getByTestId('invite-code').textContent({ timeout: 60_000 }))!.trim();
  expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await expect(page.getByTestId('invite-link')).toHaveText(`cicis://join/${code}`);
  await expect(page.getByTestId('sharing-status')).toContainText('Up to date');
  await shot(page, info, '1-invite');

  // Dewi joins on her own device: by the switcher's + on a wide screen, by the link on a phone.
  await openAccount(dewi, { subtype: 'bank', name: 'Dewi Bank', balance: '5000000' });
  if (phone) {
    // The link's code rides in the fragment, which no server sees, and leaves the address as soon as it is read.
    await dewi.goto(`/join#${code}`);
    await expect(dewi).toHaveURL(/\/join$/);
  } else {
    await dewi.goto('/transactions');
    await openSwitcher(dewi, false);
    await dewi.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'Join a workspace' }).click();
    const sheet = dewi.getByRole('dialog', { name: 'Join a workspace' });
    await sheet.getByRole('textbox', { name: 'Code' }).fill(code.toLowerCase().replace(/-/g, ' '));
    await sheet.getByRole('button', { name: 'Continue' }).click();
  }
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(join.getByText('Fandri', { exact: true })).toBeVisible();
  await join.getByLabel('Your name').fill('Dewi');
  await shot(dewi, info, '2-join-preview');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // She lands in Home, and the history is there, paid by Fandri from what Fandri paid with.
  await dewi.goto('/transactions');
  await expect(rowOf(dewi, 'History lunch')).toContainText('Fandri Bank · paid by Fandri');
  await shot(dewi, info, '3-list-paid-by');

  // The switcher says who the workspace is shared with.
  await openSwitcher(dewi, phone);
  await expect(dewi.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Home' })).toContainText('Shared with Fandri');
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
  await openWorkspaceSettings(dewi, 'Home');
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
  await openWorkspaceSettings(page, 'Home');
  const section = page.getByTestId('sharing-section');
  await expect(section.getByTestId('sharing-member')).toHaveCount(2);
  await expect(section.getByTestId('sharing-device')).toHaveCount(2);
  await shot(page, info, '5-members');
  await section.getByRole('button', { name: /, Dewi$/ }).click();
  await section.getByRole('button', { name: /^Remove Dewi’s / }).click();
  await expect(section.getByTestId('sharing-device')).toHaveCount(1, { timeout: 30_000 });
  const owner = await backupOf(page, info, 'owner');
  try {
    expect(owner.prepare('SELECT epoch FROM shared_books').get()).toEqual({ epoch: 2 });
    expect(owner.prepare('SELECT count(*) AS n FROM book_epoch_keys').get()).toEqual({ n: 2 });
    expect(owner.prepare('SELECT count(*) AS n FROM book_devices WHERE removed_at IS NOT NULL').get()).toEqual({ n: 1 });
  } finally {
    owner.close();
  }

  // Dewi's device is told it was removed (final review, I2), and keeps what it already holds, read-only.
  await openWorkspaceSettings(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('You were removed from this workspace', { timeout: 1_000 }));
  await shot(dewi, info, '6-removed-status');
  await expectReadOnly(dewi, phone, 'You were removed from this workspace');

  // And both still read the same Cashflow total.
  await cashflowTotal(page, 'Rp 110.000');
  await cashflowTotal(dewi, 'Rp 110.000');
});

/** §6.5 step 0 (ruled O3): a workspace kept in another currency than yours is refused before anything is made. */
test('a workspace in another currency than yours cannot be shared, and says why', async ({ page }, info) => {
  const phone = phoneProject(info);
  await page.goto('/transactions');
  await openSwitcher(page, phone);
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Singapore');
  await sheet.getByLabel('Reads in').selectOption('SGD');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);

  await openWorkspaceSettings(page, 'Singapore');
  await expect(page.getByText("This workspace keeps its money in SGD; this app keeps yours in IDR. Sharing across currencies isn't supported yet.")).toBeVisible();
  await expect(page.getByRole('button', { name: /Share this workspace/ })).toBeDisabled();
  await shot(page, info, '7-currency-refusal');
});

/** Fandri shares a workspace called Home and Dewi joins it: the start of every edge below. */
async function shareAndJoin(page: Page, dewi: Page) {
  await openWorkspaceSettings(page, 'Personal');
  await page.getByLabel('Name', { exact: true }).fill('Home');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Now called Home.')).toBeVisible();
  await page.getByRole('button', { name: /Share this workspace/ }).click();
  const form = page.getByRole('form', { name: 'Share this workspace' });
  await form.getByLabel('Your name').fill('Fandri');
  await form.getByRole('button', { name: 'Share', exact: true }).click();
  const code = (await page.getByTestId('invite-code').textContent({ timeout: 60_000 }))!.trim();
  await dewi.goto(`/join#${code}`);
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Your name').fill('Dewi');
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
  await openWorkspaceSettings(page, 'Home');
  await eventually(page, () => expect(page.getByTestId('sharing-member')).toHaveCount(2, { timeout: 1_000 }));
  await confirmDestructive(page, 'Leave this workspace', 'Leave this workspace?', 'Leave');
  await expect(page.getByRole('alert')).toContainText('Make someone else owner first.');
  await shot(page, info, '8-last-owner-refused');

  // Make owner: Dewi becomes one, and can invite.
  await page.getByRole('button', { name: 'Make Dewi an owner' }).click();
  await expect(page.getByTestId('sharing-member').filter({ hasText: 'Dewi' })).toContainText('Owner');
  await openWorkspaceSettings(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-member').filter({ hasText: 'Dewi (you)' })).toContainText('Owner', { timeout: 1_000 }));
  await dewi.getByRole('button', { name: 'Invite someone' }).click();
  await expect(dewi.getByTestId('invite-code')).toHaveText(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/, { timeout: 30_000 });

  // Now Fandri may leave: the book stays on Fandri's device, read-only.
  await openWorkspaceSettings(page, 'Home');
  await confirmDestructive(page, 'Leave this workspace', 'Leave this workspace?', 'Leave');
  await expect(page.getByTestId('sharing-status')).toContainText('You left this workspace', { timeout: 30_000 });
  await expectReadOnly(page, phone, 'You left this workspace');
  await shot(page, info, '9-left-read-only');

  // Dewi sees Fandri gone.
  await openWorkspaceSettings(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-device')).toHaveCount(1, { timeout: 1_000 }));
});

test('an owner stops sharing: the other side says who stopped it, and can add nothing', async ({ page, browser }, info) => {
  const phone = phoneProject(info);
  page.on('dialog', (dialog) => void dialog.accept());
  const dewi = await secondDevice(browser, info);
  await page.goto('/transactions');
  await shareAndJoin(page, dewi);

  await openWorkspaceSettings(page, 'Home');
  await confirmDestructive(page, 'Stop sharing', 'Stop sharing?', 'Stop sharing');
  // On the owner's own device it is an ordinary workspace again, which could be shared anew.
  await expect(page.getByRole('button', { name: /Share this workspace/ })).toBeVisible({ timeout: 30_000 });

  await openWorkspaceSettings(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('No longer shared by Fandri', { timeout: 1_000 }));
  await shot(dewi, info, '10-stopped-status');
  await expectReadOnly(dewi, phone, 'No longer shared by Fandri');
  await openSwitcher(dewi, phone);
  await expect(dewi.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Home' })).toContainText('No longer shared by Fandri');
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
  await eventually(page, () => expect(rowOf(page, 'Dewi before')).toContainText('paid by Dewi', { timeout: 1_000 }));

  // Fandri stops sharing; Dewi's copy goes read-only.
  await openWorkspaceSettings(page, 'Home');
  await confirmDestructive(page, 'Stop sharing', 'Stop sharing?', 'Stop sharing');
  await expect(page.getByRole('button', { name: /Share this workspace/ })).toBeVisible({ timeout: 30_000 });
  await openWorkspaceSettings(dewi, 'Home');
  await eventually(dewi, () => expect(dewi.getByTestId('sharing-status')).toContainText('No longer shared by Fandri', { timeout: 1_000 }));
  await expectReadOnly(dewi, phone, 'No longer shared by Fandri');

  // Fandri shares it again, as the same person: the members are Fandri and the remembered Dewi, nobody twice.
  await openWorkspaceSettings(page, 'Home');
  await page.getByRole('button', { name: /Share this workspace/ }).click();
  const form = page.getByRole('form', { name: 'Share this workspace' });
  await form.getByLabel('Your name').fill('Fandri');
  await form.getByRole('button', { name: 'Share', exact: true }).click();
  const first = (await page.getByTestId('invite-code').textContent({ timeout: 60_000 }))!.trim();
  const section = page.getByTestId('sharing-section');
  await expect(section.getByTestId('sharing-member')).toHaveCount(2);
  await expect(section.getByTestId('sharing-member').filter({ hasText: 'Fandri (you)' })).toContainText('Owner');
  await expect(section.getByTestId('sharing-member').filter({ hasText: 'Dewi' })).toContainText('Member');
  // Dewi's copy rejoins as Dewi: an invite that links a device for her.
  await section.getByRole('button', { name: 'Link a device for Dewi' }).click();
  await expect(page.getByTestId('invite-code')).not.toHaveText(first, { timeout: 30_000 });
  const code = (await page.getByTestId('invite-code').textContent())!.trim();
  await shot(page, info, '11-link-for-dewi');

  await dewi.goto(`/join#${code}`);
  const join = dewi.getByTestId('join-workspace');
  await expect(join.getByText('Home', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(join.getByText('This device joins as Dewi.')).toBeVisible();
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // Shared again on Dewi's side: syncing, no longer read-only, and everything from before is still there.
  await openWorkspaceSettings(dewi, 'Home');
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
