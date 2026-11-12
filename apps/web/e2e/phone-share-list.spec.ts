import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { addForm } from './add-transaction';
import { openGoalForm, setAssumption } from './goals';
import { goalRow } from './set-aside';
import { eventually, newEvent } from './shared-events';
import { openSharePage, openWorkspacePage, openWorkspaceSharePage, renameWorkspace, shareWorkspace } from './workspace-page';

/*
 * One list to choose what to share (2026-11-12), on two phones. Rina shares Family and Andi joins; both share net
 * worth, filed separately. Rina's Share page then offers the last step of setting up: one list with a tick per item.
 * She ticks one account with Joint, one goal and one event, and Share runs each through its own page's action: Andi
 * sees the account among Rina's shared items and in Paid with (Joint), the goal in Goals, and — once he joins with the
 * event's own invite — the event in Events. Every name and figure is invented.
 */

test.describe.configure({ timeout: 600_000 });

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

const tick = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });

test('the share list: Rina ticks an account with Joint, a goal and an event; Andi sees all three', async ({ page: rina, browser }, info) => {
  const andi = await secondPhone(browser, info);
  for (const phone of [rina, andi]) phone.on('dialog', (dialog) => void dialog.accept());

  await openAccount(rina, { subtype: 'bank', name: 'Rina Savings', balance: '42000000' });
  await openAccount(rina, { subtype: 'cash', name: 'Rina Pocket', balance: '350000' });
  await openAccount(andi, { subtype: 'bank', name: 'Andi Daily', balance: '7300000' });

  // Rina's goal and event, neither shared.
  await rina.goto('/goals');
  await openGoalForm(rina, 'Holiday');
  await rina.getByLabel('Name', { exact: true }).fill('Umrah plan');
  await rina.getByLabel(/Cost today/).first().pressSequentially('64000000');
  await rina.getByLabel('Due by').first().fill('2031-03-31');
  await setAssumption(rina, 'Cost growth a year', '0');
  await rina.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(goalRow(rina, 'Umrah plan')).toBeVisible();
  await newEvent(rina, 'Lombok weekend');

  // Rina calls Personal Family and shares it; Andi joins it.
  await openWorkspacePage(rina, 'Personal');
  await renameWorkspace(rina, 'Family');
  await expect(rina.getByText('Now called Family.')).toBeVisible();
  await openSharePage(rina);
  const shareUrl = rina.url();
  const code = await shareWorkspace(rina, 'Rina');
  await andi.goto(`/join#${code}`);
  const join = andi.getByTestId('join-workspace');
  await expect(join).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });

  // Before net worth is shared, the step offers net worth as a row of its own; Later puts the list off.
  const step = rina.getByTestId('share-list-setup');
  await eventually(rina, () => expect(step).toBeVisible({ timeout: 1_000 }));
  await expect(rina.getByRole('heading', { name: 'Share with Andi' })).toBeVisible();
  await expect(step).toContainText('Step 2 of 2');
  await expect(step).toContainText('Family’s budgets, bills and transactions are already shared. Pick what else Andi sees. Nothing here is shared until ticked.');
  await expect(rina.getByTestId('share-list-net-worth')).toContainText('Off');
  await expect(tick(rina, 'Lombok weekend')).not.toBeChecked();
  await rina.getByTestId('share-list-later').click();
  await expect(rina).toHaveURL(/\/share$/);
  // Put off once, it is not offered again: the list is a row of the Share page now.
  await expect(rina.getByTestId('share-list-row')).toContainText('What’s shared with Andi');
  await expect(rina.getByTestId('share-list-row')).toContainText('None');
  await expect(rina.getByText('Budgets, bills, categories and Family’s transactions are shared with Family as a whole.')).toBeVisible();

  // Both share net worth, filed separately.
  await rina.goto(`${shareUrl}/net-worth`);
  const setup = rina.getByTestId('net-worth-setup');
  await eventually(rina, () => expect(setup.getByTestId('filing-separate')).toBeVisible({ timeout: 1_000 }));
  await setup.getByTestId('filing-separate').click();
  await setup.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(rina.getByTestId('net-worth-waiting')).toContainText('Waiting for Andi', { timeout: 30_000 });
  await openWorkspaceSharePage(andi, 'Family');
  await andi.getByTestId('net-worth-row').click();
  await eventually(andi, () => expect(andi.getByTestId('net-worth-asked')).toContainText('Rina asks to share net worth', { timeout: 1_000 }));
  await andi.getByRole('button', { name: 'Confirm', exact: true }).click();
  await eventually(andi, () => expect(andi.getByTestId('net-worth-status')).toContainText('Shared with Rina', { timeout: 1_000 }));

  // Rina's list, from the Share page: one account with Joint, one goal, one event.
  await rina.goto(shareUrl);
  await eventually(rina, async () => {
    await expect(rina.getByTestId('share-list-row')).toBeVisible({ timeout: 1_000 });
  });
  await rina.getByTestId('share-list-row').click();
  const list = rina.getByTestId('share-list');
  await expect(rina.getByRole('heading', { name: 'What’s shared with Andi' })).toBeVisible();
  await eventually(rina, () => expect(tick(rina, 'Umrah plan')).toBeVisible({ timeout: 1_000 }));
  await expect(list.getByTestId('share-list-accounts')).toContainText('Ticked: Andi sees its balance on Net worth. Joint: Andi can also pay from it in Family and sees its rows.');
  for (const name of ['Rina Savings', 'Rina Pocket', 'Umrah plan', 'Lombok weekend']) await expect(tick(rina, name)).not.toBeChecked();
  // Rina has not reviewed her net worth yet: nothing of it reads as shared, and the list says so.
  await expect(list.getByTestId('share-list-review')).toBeVisible();
  await expect(list.getByTestId('share-list-row').filter({ hasText: 'Rina Pocket' })).toContainText('Not shared yet');
  // The event says the currency a share puts it in.
  await expect(list.getByTestId('share-list-row').filter({ hasText: 'Lombok weekend' })).toContainText('IDR');
  // Joint is offered only once the account is ticked.
  await expect(rina.getByRole('button', { name: 'Joint, Rina Savings' })).toHaveCount(0);
  await tick(rina, 'Rina Savings').click();
  await rina.getByRole('button', { name: 'Joint, Rina Savings' }).click();
  await expect(rina.getByRole('button', { name: 'Joint, Rina Savings' })).toHaveAttribute('aria-pressed', 'true');
  await tick(rina, 'Umrah plan').click();
  await tick(rina, 'Lombok weekend').click();
  // Ticked to share, the event says what sharing it moves, in its Share sheet's own words.
  await expect(list.getByTestId('share-list-events')).toContainText('What is tagged to it moves out of its workspace');
  await rina.getByRole('button', { name: 'Save', exact: true }).click();

  // The event's share ends in its own invite, to send to Andi.
  const outcome = rina.getByTestId('share-list-outcome');
  await expect(outcome).toBeVisible({ timeout: 60_000 });
  await expect(rina.getByTestId('share-list-failed')).toHaveCount(0);
  const eventCode = (await outcome.getByTestId('invite-code').textContent({ timeout: 60_000 }))!.trim();
  await rina.getByTestId('share-list-done').click();
  await expect(rina).toHaveURL(/\/share$/);
  await expect(rina.getByTestId('share-list-row')).toContainText('3 items');

  // Andi: the account, joint, is a card of Rina's on his Wallet; the one left unticked is nowhere.
  await eventually(andi, async () => {
    await andi.goto('/wallet');
    await expect(walletCard(andi, 'Rina Savings')).toBeVisible({ timeout: 2_000 });
  });
  await expect(walletCard(andi, 'Rina Savings')).toHaveAccessibleName(/^Rina Savings, Rina’s/);
  await expect(andi.getByText('Rina Pocket')).toHaveCount(0);
  const paidWith = andi.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Rina Savings, Rina’s, shared', exact: true });
  await eventually(andi, async () => {
    await andi.goto('/transactions');
    await andi.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
    await addForm(andi).getByRole('button', { name: /^Paid with/ }).click();
    await expect(paidWith).toContainText('Joint', { timeout: 1_000 });
  });

  // The goal in Andi's Goals.
  await eventually(andi, async () => {
    await andi.goto('/goals');
    await expect(goalRow(andi, 'Umrah plan')).toBeVisible({ timeout: 1_000 });
  });

  // The event, once Andi joins it with its code.
  await andi.goto(`/join#${eventCode}`);
  const joinEvent = andi.getByTestId('join-event');
  await expect(joinEvent).toBeVisible({ timeout: 30_000 });
  await joinEvent.getByLabel('Name').fill('Andi');
  await joinEvent.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(joinEvent).toHaveCount(0, { timeout: 60_000 });
  await andi.goto('/events');
  await expect(andi.getByTestId('event-row').filter({ hasText: 'Lombok weekend' })).toBeVisible({ timeout: 30_000 });

  // Back on Rina's list: the event stays ticked and cannot be unticked, with why.
  await rina.getByTestId('share-list-row').click();
  await expect(tick(rina, 'Lombok weekend')).toBeChecked();
  await expect(tick(rina, 'Lombok weekend')).toHaveAttribute('aria-disabled', 'true');
  await expect(rina.getByTestId('share-list-events')).toContainText('A shared event stays shared. Leave is under Events on the Share page.');
});
