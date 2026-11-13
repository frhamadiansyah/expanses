import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { addForm } from './add-transaction';
import { openGoalForm, setAssumption } from './goals';
import { goalRow } from './set-aside';
import { eventually, newEvent } from './shared-events';
import { openSharePage, openWorkspacePage, renameWorkspace, shareWorkspace } from './workspace-page';

/*
 * One list to choose what to share (2026-11-12; simplified 2026-11-13), on two phones. Rina shares Family and Andi joins;
 * the last step of setting up opens by itself — "Shared with Andi", a switch each — and Later puts it off. From the Share
 * page she switches on one account, marks it owned together from its icon, and a goal; Save starts net worth with Andi
 * by itself (no filing question, no review, no Confirm on Andi's phone). An event's switch opens its own share sheet,
 * with its own code. Andi sees the account in his Wallet and Paid with, the goal in Goals, and the event once he joins
 * it. Every name and figure is invented.
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

  // The step: Shared with Andi, what Family always shares, nothing switched on; Later puts the list off.
  const step = rina.getByTestId('share-list-setup');
  await eventually(rina, () => expect(step).toBeVisible({ timeout: 1_000 }));
  await expect(rina.getByRole('heading', { name: 'Shared with Andi' })).toBeVisible();
  await expect(step).toContainText('Step 3 of 3');
  await expect(rina.getByTestId('share-list-always')).toContainText('Budgets, bills and transactions');
  await expect(tick(rina, 'Rina Savings')).not.toBeChecked();
  await expect(tick(rina, 'Lombok weekend')).not.toBeChecked();
  await rina.getByTestId('share-list-later').click();
  await expect(rina).toHaveURL(/\/share$/);
  // Put off once, it is not offered again: the list is a row of the Share page now.
  await expect(rina.getByTestId('share-list-row')).toContainText('Shared with Andi');
  await expect(rina.getByTestId('share-list-row')).toContainText('Nothing yet');

  // Rina's list, from the Share page: one account owned together, and one goal.
  await rina.getByTestId('share-list-row').click();
  const list = rina.getByTestId('share-list');
  await expect(rina.getByRole('heading', { name: 'Shared with Andi' })).toBeVisible();
  await eventually(rina, () => expect(tick(rina, 'Umrah plan')).toBeVisible({ timeout: 1_000 }));
  for (const name of ['Rina Savings', 'Rina Pocket', 'Umrah plan', 'Lombok weekend']) await expect(tick(rina, name)).not.toBeChecked();
  // The event says the currency a share puts it in.
  await expect(list.getByTestId('share-list-row').filter({ hasText: 'Lombok weekend' })).toContainText('IDR');
  await tick(rina, 'Rina Savings').click({ force: true });
  await rina.getByRole('button', { name: 'Owned together, Rina Savings' }).click();
  await expect(rina.getByRole('button', { name: 'Owned together, Rina Savings' })).toHaveAttribute('aria-pressed', 'true');
  await tick(rina, 'Umrah plan').click({ force: true });
  await rina.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rina).toHaveURL(/\/share$/, { timeout: 60_000 });
  await eventually(rina, () => expect(rina.getByTestId('share-list-row')).toContainText('1 account · 1 goal', { timeout: 1_000 }));

  // The event's switch opens its own share sheet, which ends in its own invite, to send to Andi.
  await rina.getByTestId('share-list-row').click();
  await tick(rina, 'Lombok weekend').click({ force: true });
  const share = rina.getByRole('form', { name: 'Share this event' });
  await expect(share).toBeVisible();
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const eventCode = (await rina.getByTestId('invite-code').textContent({ timeout: 60_000 }))!.trim();

  // Andi: the account, owned together, is a card of Rina's on his Wallet; the one left off is nowhere.
  await eventually(andi, async () => {
    await rina.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
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
    await expect(paidWith).toContainText('owned together', { timeout: 1_000 });
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

  // Back on Rina's list: the event is on, and says Andi is in.
  await rina.goto(shareUrl);
  await rina.getByTestId('share-list-row').click();
  await expect(tick(rina, 'Lombok weekend')).toBeChecked();
  await eventually(rina, () => expect(rina.getByTestId('share-list-events')).toContainText('Andi is in', { timeout: 1_000 }));
});
