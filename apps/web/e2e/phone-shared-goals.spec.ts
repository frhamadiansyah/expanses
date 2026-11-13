import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset, pastPurchase } from './add-asset';
import { openDrawers } from './drawers';
import { editGoal, goalMenu, openGoalForm, setAssumption } from './goals';
import { goalCard, goalRow, setAside } from './set-aside';
import { openHolding } from './goal-funding';
import { eventually } from './shared-events';
import { openWorkspaceSharePage, putOffShareList, shareWorkspace } from './workspace-page';

/*
 * A goal shared by two phones, end to end (shared goals §12). Bima and Rina share the Personal workspace. Bima makes
 * the goal and turns the switch on; both set money aside from accounts of their own; each phone reads the other's money
 * by name and never by account; Rina marks the payment paid and Bima's phone follows; Bima turns sharing off and Rina
 * keeps a private copy with her own money in it. Every figure and name is invented.
 *
 * It runs on the phone project (the file name says so). Two contexts are two phones, each with its own database and
 * keys, on the local relay Worker the Playwright config starts.
 */

test.describe.configure({ timeout: 300_000 });

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

/** One line of the goal page's legend (Me, a member, To go, Paid), by its words. */
const legend = (card: ReturnType<Page['getByTestId']>, word: string) => card.locator('[data-testid^="goal-seg-"]').filter({ hasText: word });

/** A goal's open page, once the goal has reached this phone. */
async function openGoalWhenItArrives(page: Page, name: string) {
  await eventually(page, async () => {
    await page.goto('/goals');
    await expect(goalRow(page, name)).toBeVisible({ timeout: 1_000 });
  });
  return goalCard(page, name);
}

test('a goal shared by two phones: both fund it, each sees the other by name, a payment paid across, sharing turned off', async ({ page: bima, browser }, info) => {
  const rina = await secondPhone(browser, info);
  for (const phone of [bima, rina]) phone.on('dialog', (dialog) => void dialog.accept());

  await openAccount(bima, { subtype: 'bank', name: 'Main Savings', balance: '50000000' });
  await openAccount(bima, { subtype: 'bank', name: 'Daily Account', balance: '20000000' });
  await openAccount(rina, { subtype: 'bank', name: 'Partner Savings', balance: '30000000' });

  // Bima shares the workspace; Rina joins it under her own name.
  await openWorkspaceSharePage(bima, 'Personal');
  const code = await shareWorkspace(bima, 'Bima');
  await rina.goto(`/join#${code}`);
  const join = rina.getByTestId('join-workspace');
  await expect(join).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Rina');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(bima);

  // Bima's goal, shared with Rina by its switch.
  await bima.goto('/goals');
  await openGoalForm(bima, 'Holiday');
  await bima.getByLabel('Name', { exact: true }).fill('Trip Fund');
  await bima.getByLabel(/Cost today/).first().pressSequentially('180000000');
  await bima.getByLabel('Due by').first().fill('2030-06-30');
  // No cost growth, so the target is the typed 180.000.000 and not that sum grown to 2030.
  await setAssumption(bima, 'Cost growth a year', '0');
  const sharing = bima.getByTestId('goal-share-switch');
  // The switch waits for Rina's phone and its version to reach Bima's (§8.6): a sync may still be on its way.
  await eventually(bima, async () => {
    await expect(bima.getByText('Shared with Rina', { exact: true })).toBeVisible({ timeout: 1_000 });
  });
  await sharing.check({ force: true });
  await expect(sharing).toBeChecked();
  await bima.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(goalRow(bima, 'Trip Fund')).toBeVisible();

  await setAside(bima, 'Trip Fund', 'Main Savings', '20000000');
  await setAside(bima, 'Trip Fund', 'Daily Account', '8000000');

  // Rina's phone has the goal, and she funds it from her side: cash from her account, and a purchase tagged.
  const hers = await openGoalWhenItArrives(rina, 'Trip Fund');
  await expect(hers.getByTestId('goal-shared-with')).toContainText('Shared with Bima');
  await openNewAsset(rina, 'Gold bullion');
  await rina.getByLabel('Name', { exact: true }).fill('Cash Fund');
  await pastPurchase(rina);
  await fillDay(rina, 'Bought', '2026-03-09');
  await rina.getByLabel('How much').fill('10');
  await rina.getByLabel('Total cost', { exact: true }).fill('4000000');
  await rina.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(rina);
  await expect(rina.getByRole('link', { name: /Cash Fund/ })).toBeVisible();
  await rina.goto('/net-worth/prices');
  await rina.getByLabel(/Cash Fund/).fill('400000');
  await rina.getByRole('button', { name: 'Save prices' }).click();
  await expect(rina.getByText(/· Typed/)).toBeVisible();

  await setAside(rina, 'Trip Fund', 'Partner Savings', '10000000');
  const mine = await goalCard(rina, 'Trip Fund');
  await mine.getByRole('button', { name: 'Tag a purchase', exact: true }).click();
  await (await openHolding(rina, 'Cash Fund')).getByRole('button', { name: 'Tag 1', exact: true }).click();

  // Both phones read the same sums: their own money as Me, the other's by name.
  const onBima = await goalCard(bima, 'Trip Fund');
  await eventually(bima, async () => {
    await expect(legend(onBima, 'Rina')).toContainText('14.000.000', { timeout: 1_000 });
  });
  await expect(legend(onBima, 'Me')).toContainText('28.000.000');
  await expect(legend(onBima, 'To go')).toContainText('138.000.000');
  const onRina = await goalCard(rina, 'Trip Fund');
  await eventually(rina, async () => {
    await expect(legend(onRina, 'Bima')).toContainText('28.000.000', { timeout: 1_000 });
  });
  await expect(legend(onRina, 'Me')).toContainText('14.000.000');
  await expect(legend(onRina, 'To go')).toContainText('138.000.000');

  // Rina's money on Bima's phone is a name and an amount: each row says "Rina's account" and opens nothing.
  const rinaRows = onBima.getByTestId('goal-link').filter({ hasText: 'Rina’s account' }).or(onBima.getByTestId('goal-link').filter({ hasText: "Rina's account" }));
  await expect(rinaRows).toHaveCount(2);
  await expect(rinaRows.filter({ hasText: 'Partner Savings' })).toContainText('10.000.000');
  await expect(rinaRows.filter({ hasText: 'Cash Fund' })).toContainText('4.000.000');
  await expect(rinaRows.locator('a')).toHaveCount(0);
  await expect(onBima.locator('a[href*="/net-worth/assets/"]').filter({ hasText: /Partner Savings|Cash Fund/ })).toHaveCount(0);

  // Rina marks the payment paid; Bima's phone reads it paid.
  // The goal has one payment, so Mark paid is on its page's ⋯.
  await goalMenu(rina, /^Mark paid$/);
  await eventually(bima, async () => {
    await bima.goto('/goals');
    await goalRow(bima, 'Trip Fund').click();
    await expect(legend(bima.getByTestId('goal-page'), 'Paid')).toBeVisible({ timeout: 1_000 });
  });

  // Bima turns sharing off. Rina keeps one Trip Fund, with only her own money in it and no one's initials.
  await bima.goto('/goals');
  await goalRow(bima, 'Trip Fund').click();
  await editGoal(bima);
  // The switch reads the share as it stands before it is drawn: on, here. Unchecking it then turns sharing off.
  const switchNow = bima.getByTestId('goal-share-switch');
  await expect(switchNow).toBeChecked({ timeout: 15_000 });
  await switchNow.uncheck({ force: true });
  await expect(switchNow).not.toBeChecked();
  await bima.getByRole('button', { name: 'Save goal' }).last().click();
  const after = await goalCard(bima, 'Trip Fund');
  await expect(after.getByTestId('goal-shared-with')).toHaveCount(0);
  await expect(after.getByTestId('goal-link').filter({ hasText: 'Rina' })).toHaveCount(0);
  await expect(after.getByTestId('goal-link').filter({ hasText: 'Main Savings' })).toBeVisible();

  // The row may still be the shared goal's when it is tapped, and the off arrive just after ("Goal not here"): the
  // check is passed only on the copy's own page, with her money in it.
  const copy = rina.getByTestId('goal-page');
  await eventually(rina, async () => {
    await rina.goto('/goals');
    await expect(goalRow(rina, 'Trip Fund')).toHaveCount(1, { timeout: 1_000 });
    await goalRow(rina, 'Trip Fund').click();
    await expect(copy).toBeVisible({ timeout: 1_000 });
    await expect(rina.getByTestId('goal-shared-with')).toHaveCount(0, { timeout: 1_000 });
    await expect(copy.getByTestId('goal-link').filter({ hasText: 'Partner Savings' })).toContainText('10.000.000', { timeout: 1_000 });
  });
  await expect(copy.getByTestId('goal-link').filter({ hasText: 'Bima' })).toHaveCount(0);
});
