import { join } from 'node:path';
import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { addForm } from './add-transaction';
import { eventually } from './shared-events';
import { openSharePage, openWorkspacePage, renameWorkspace, shareWorkspace } from './workspace-page';

/*
 * Household sharing, simplified (2026-11-13), on two phones and on a wide screen: Rina shares Family in three steps —
 * Name and Create invite, the invite, then "Shared with Andi" once he joins — switches her bank account on, and marks it
 * owned together by tapping its icon (with Undo; off asks first). Nobody answers a net worth setup or a review: Andi's
 * phone confirms by itself, and the account is a card in his Wallet. Every name and figure is invented.
 */

test.describe.configure({ timeout: 600_000 });

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

/** Full-page screenshots for the report, when SHARING_SHOTS names a folder. */
async function shot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.SHARING_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${info.project.name}-simplified-${name}.png`), fullPage: true });
}

const toggle = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const icon = (page: Page, name: string) => page.getByRole('button', { name: `Owned together, ${name}`, exact: true });

test('three steps, one list: a shared account marked owned together from its icon, and Andi pays from it with no review', async ({ page: rina, browser }, info) => {
  const andi = await secondPhone(browser, info);
  for (const phone of [rina, andi]) phone.on('dialog', (dialog) => void dialog.accept());
  if (process.env.DEBUG_NW) for (const [who, phone] of [['rina', rina], ['andi', andi]] as const) phone.on('console', (m) => (m.type() === 'warning' || m.type() === 'error') && console.log(who, m.type(), m.text()));

  await openAccount(rina, { subtype: 'bank', name: 'BCA 0917', balance: '23500000' });
  await openAccount(rina, { subtype: 'cash', name: 'Rina Pocket', balance: '410000' });
  await openAccount(andi, { subtype: 'bank', name: 'Andi Daily', balance: '6100000' });

  // Step 1: a name and Create invite, with what is shared at once and what waits for step 3.
  await openWorkspacePage(rina, 'Personal');
  await renameWorkspace(rina, 'Family');
  await expect(rina.getByText('Now called Family.')).toBeVisible();
  await openSharePage(rina);
  await expect(rina.getByTestId('share-step')).toHaveText('Step 1 of 3');
  await expect(rina.getByTestId('share-lede')).toHaveText('Budgets, bills and transactions in Family will be shared. Accounts, goals and events stay private until switched on in step 3.');
  await expect(rina.getByRole('button', { name: 'Create invite' })).toBeVisible();
  await shot(rina, info, '1-start');

  // Step 2: the invite.
  const code = await shareWorkspace(rina, 'Rina');
  await expect(rina.getByTestId('share-step')).toHaveText('Step 2 of 3');
  await shot(rina, info, '2-invite');
  await andi.goto(`/join#${code}`);
  const join = andi.getByTestId('join-workspace');
  await expect(join).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // Step 3 opens by itself once Andi is in: what Family always shares, then accounts, with a switch each.
  const step = rina.getByTestId('share-list-setup');
  await eventually(rina, () => expect(step).toBeVisible({ timeout: 1_000 }));
  await expect(step).toContainText('Step 3 of 3');
  await expect(rina.getByRole('heading', { name: 'Shared with Andi' })).toBeVisible();
  await expect(rina.getByTestId('share-list-always')).toContainText('Family’s records');
  await expect(toggle(rina, 'BCA 0917')).not.toBeChecked();
  await expect(rina.getByTestId('share-list-accounts')).toContainText('Tap a shared account’s icon to mark it owned together');

  // The icon of an account not shared says what to do instead.
  await icon(rina, 'BCA 0917').click();
  await expect(rina.getByTestId('share-list-hint')).toContainText('Switch Shared on first');
  await expect(icon(rina, 'BCA 0917')).toHaveAttribute('aria-pressed', 'false');

  // Shared on, then the icon: owned together, with a short Undo bar; Undo takes it back.
  await toggle(rina, 'BCA 0917').click({ force: true });
  await expect(toggle(rina, 'BCA 0917')).toBeChecked();
  await icon(rina, 'BCA 0917').click();
  await expect(icon(rina, 'BCA 0917')).toHaveAttribute('aria-pressed', 'true');
  await expect(rina.getByTestId('share-list-undo')).toContainText('BCA 0917 owned together');
  await expect(rina.getByTestId('owned-together-mark')).toHaveCount(1);
  await shot(rina, info, '3-shared-with');
  await rina.getByTestId('share-list-undo').getByRole('button', { name: 'Undo' }).click();
  await expect(icon(rina, 'BCA 0917')).toHaveAttribute('aria-pressed', 'false');
  await icon(rina, 'BCA 0917').click();
  await expect(icon(rina, 'BCA 0917')).toHaveAttribute('aria-pressed', 'true');

  // Off asks first; Cancel keeps it.
  await icon(rina, 'BCA 0917').click();
  const ask = rina.getByRole('dialog', { name: 'Stop owning BCA 0917 together?' });
  await expect(ask).toContainText('Andi will still see its balance, but not its rows');
  await shot(rina, info, '4-ask-off');
  await expect(rina.getByTestId('share-list-undo')).toHaveCount(0);
  await ask.getByRole('button', { name: 'Close' }).click();
  await expect(icon(rina, 'BCA 0917')).toHaveAttribute('aria-pressed', 'true');

  // Done: the first account shared starts net worth with Andi, filed separately. Back on the Share page, A1.
  await rina.getByTestId('share-list-share').click();
  await expect(rina).toHaveURL(/\/share$/, { timeout: 60_000 });
  await expect(rina.getByTestId('share-list-row')).toContainText('1 account');
  await expect(rina.getByTestId('sharing-sync-row')).toBeVisible();
  await expect(rina.getByTestId('net-worth-row')).toHaveCount(0);
  await shot(rina, info, '5-share-page');
  await rina.getByTestId('sharing-sync-row').click();
  await expect(rina.getByRole('heading', { name: 'Sync details' })).toBeVisible();
  await expect(rina.getByTestId('sync-phone')).toHaveCount(2, { timeout: 30_000 });
  await shot(rina, info, '6-sync-details');

  // Andi answered nothing: his phone confirmed, Rina's sent, and the account is a card in his Wallet he can pay from.
  await eventually(andi, async () => {
    await rina.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await andi.goto('/wallet');
    await expect(walletCard(andi, 'BCA 0917')).toBeVisible({ timeout: 2_000 });
  });
  await expect(andi.getByText('Rina Pocket')).toHaveCount(0);
  await andi.goto('/transactions');
  await andi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  await addForm(andi).getByRole('button', { name: /^Payment method/ }).click();
  const paidWith = andi.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: 'BCA 0917, Rina’s, shared', exact: true });
  await expect(paidWith).toContainText('owned together');
  await expect(paidWith.getByTestId('owned-together-mark')).toBeVisible();
  await shot(andi, info, '7-andi-paid-with');

  // The account's own Settings: the same two switches.
  await rina.goto('/wallet');
  await walletCard(rina, 'BCA 0917').click();
  await rina.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(rina.getByRole('checkbox', { name: 'Shared with Andi' })).toBeChecked();
  await expect(rina.getByRole('checkbox', { name: 'Owned together' })).toBeChecked();
  await rina.getByRole('checkbox', { name: 'Owned together' }).scrollIntoViewIfNeeded();
  await shot(rina, info, '8-account-settings');

  // The filing is asked in the tax report: a new household files separately.
  await rina.goto('/tax-report');
  await expect(rina.getByTestId('household-filing')).toContainText('Filed separately');
  await shot(rina, info, '9-tax-report');
});
