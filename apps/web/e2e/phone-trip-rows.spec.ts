import { type Browser, expect, type Locator, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount, openAccountHistory } from './accounts';
import { addForm, chooseTo, choosePayment, fillAmount, openAmount, saveButton, startSelecting } from './add-transaction';
import { corner, eventually, newEvent, openTrip, recordSharedSpend, showBalances, showCard, spendingRow } from './shared-events';
import { openWorkspaceSharePage, putOffShareList, shareWorkspace, workspaceLine } from './workspace-page';

/*
 * A shared trip's history rows look like a private trip's (owner 2026-11-14): the same circle, the same title,
 * subtitle and amount sizes, the same day card. The shared spending row reads category on top, the note and who paid
 * under it, and the share under the amount. Invented names and figures. With E2E_MOCKUP_SHOTS set, the two day cards
 * are written to docs/mockups.
 */

test.describe.configure({ timeout: 240_000 });

const SHOTS = process.env.E2E_MOCKUP_SHOTS;

/** What sets a row's look: the circle's size, and each line's font size and weight. */
async function look(row: Locator) {
  return row.evaluate((li) => {
    const font = (el: Element | null) => (el ? { size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight } : null);
    const mark = li.querySelector('[data-testid="category-mark"]')!.getBoundingClientRect();
    const lines = li.querySelectorAll('span.block.truncate');
    return {
      mark: [Math.round(mark.width), Math.round(mark.height)],
      title: font(lines[0] ?? null),
      subtitle: font(lines[1] ?? null),
      amount: font(li.querySelector('span.tabular.block')),
      under: font(li.querySelector('[data-testid="amount-extra"]')),
      height: Math.round(li.getBoundingClientRect().height),
    };
  });
}

/**
 * The hairlines of the day card round `row`: for every row after the first, its top corners' rounding and how far the
 * line stands in from the card's edges. Straight, and the same inset on every kind of row.
 */
async function hairlines(row: Locator) {
  return row.evaluate((li) => {
    const list = li.closest('ul')!;
    const card = list.parentElement!.getBoundingClientRect();
    return [...list.children].slice(1).map((item) => {
      const style = getComputedStyle(item);
      const box = item.getBoundingClientRect();
      return { radius: [style.borderTopLeftRadius, style.borderTopRightRadius], width: style.borderTopWidth, inset: [Math.round(box.left - card.left), Math.round(card.right - box.right)] };
    });
  });
}

async function addTripSpend(page: Page, o: { note: string; amount: string; paidWith: string }) {
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  const form = addForm(page);
  await expect(form.getByTestId('event-chip')).toBeVisible();
  await openAmount(form);
  await fillAmount(page, form, o.amount);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, o.paidWith);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill(o.note);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

test('a shared trip draws its records as a private trip draws its transactions', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '90000000' });

  // A private trip, with one purchase in it through event mode.
  await newEvent(page, 'Ridge walk');
  await page.getByTestId('event-mode-group').getByTestId('event-mode-switch').check();
  await page.goto('/transactions');
  await addTripSpend(page, { note: 'Hill market', amount: '235000', paidWith: 'Rina Bank' });
  await addTripSpend(page, { note: 'Bakery stop', amount: '64000', paidWith: 'Rina Bank' });
  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Ridge walk' }).click();
  const privateRow = page.getByTestId('event-history').filter({ hasText: 'Hill market' });
  await expect(privateRow).toBeVisible();
  const privateLook = await look(privateRow);
  const privateLines = await hairlines(privateRow);
  expect(privateLines).toHaveLength(1);
  expect(privateLines[0]!.radius).toEqual(['0px', '0px']);
  // The day card: the panel round the row's list.
  if (SHOTS) await privateRow.locator('xpath=ancestor::ul[1]/..').screenshot({ path: `${SHOTS}/2026-11-14-trip-rows-private.png` });
  await page.getByTestId('event-mode-group').getByTestId('event-mode-switch').uncheck();

  // A shared trip with Budi, who has no app: a spending, and Budi settling up with Rina.
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);
  await corner(page, 'Add spending');
  await recordSharedSpend(page, { note: 'Fish dinner', amount: '480000', paidWith: 'Rina Bank' });
  await corner(page, 'Add spending');
  await recordSharedSpend(page, { note: 'Boat ride', amount: '150000', paidWith: 'Rina Bank' });
  await showBalances(page);
  await page.getByTestId('shared-payment-row').first().click();
  const settle = page.getByTestId('settle-up');
  await settle.getByLabel('Received into').selectOption({ label: 'Rina Bank · IDR' });
  await settle.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(settle).toHaveCount(0, { timeout: 30_000 });
  await showCard(page, 'Spending');

  const expense = spendingRow(page, 'Fish dinner');
  // Category on top, the note and who paid under it, the share under the amount.
  await expect(expense.locator('span.block.truncate').first()).toHaveText('Other');
  await expect(expense.locator('span.block.truncate').nth(1)).toHaveText(/^Fish dinner · Rina paid · /);
  await expect(expense.getByTestId('amount-extra')).toHaveText(/^share Rp\s240\.000$/);
  const settlement = page.getByTestId('shared-settlement-row');
  await expect(settlement).toContainText('Budi paid Rina');

  // The same look as the private row: circle, and every line's size and weight. The line under the amount is a
  // private row's foreign-figure line (12 px), here holding the share.
  const { under, height: _h, ...same } = await look(expense);
  const { under: _u, height: _p, ...privateSame } = privateLook;
  expect(same).toEqual(privateSame);
  expect(under).toEqual({ size: '12px', weight: '400' });
  const { under: _s, height: _sh, ...settlementSame } = await look(settlement);
  expect(settlementSame).toEqual(privateSame);
  // Straight hairlines between the records, standing in from the card's edges exactly as the private card's.
  const sharedLines = await hairlines(expense.first());
  expect(sharedLines).toHaveLength(2);
  for (const line of sharedLines) expect(line).toEqual(privateLines[0]);
  // The same day card: its rows sit in a panel the same width as the private one's.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A tap still opens the spending to edit.
  await expense.click();
  await expect(page).toHaveURL(/\/transactions\/new\?.*expense=/);
});

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

async function openWorkspace(page: Page, name: string) {
  await page.goto('/account');
  const line = workspaceLine(page, name);
  await line.getByTestId('workspace-switch').click();
  await expect(line.getByLabel('Open', { exact: true })).toBeVisible();
}

test('a shared trip day with a spending, a settle-up and a household transfer: one row look, straight hairlines', async ({ page: owner, browser }, info) => {
  test.setTimeout(300_000);
  const partner = await secondPhone(browser, info);
  for (const phone of [owner, partner]) phone.on('dialog', (dialog) => void dialog.accept());
  await openAccount(owner, { subtype: 'bank', name: 'Rina Bank', balance: '90000000' });
  await openAccount(owner, { subtype: 'cash', name: 'Rina Cash', balance: '100000' });

  // Family, a workspace of its own, shared with Andi.
  await owner.goto('/account');
  await owner.getByTestId('add-workspace').click();
  await owner.getByTestId('new-workspace').click();
  const sheet = owner.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Family');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
  await openWorkspaceSharePage(owner, 'Family');
  const code = await shareWorkspace(owner, 'Rina');
  await partner.goto(`/join#${code}`);
  const join = partner.getByTestId('join-workspace');
  await expect(join.getByText('Family', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(owner);

  // The trip, shared with Andi and with Budi, who has no app.
  await newEvent(owner, 'Coast week');
  await corner(owner, 'Share this event');
  const share = owner.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  // Shared from "Shared with Andi" the trip would start in one pot; with Budi in it, costs are split.
  const split = share.getByRole('checkbox', { name: 'Split costs' });
  await expect(split).not.toBeChecked();
  await split.click({ force: true });
  await expect(split).toBeChecked();
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const link = (await owner.getByTestId('invite-link').textContent({ timeout: 60_000 }))!.trim();
  await partner.goto(`/join#${link.replace('cicis://join/', '')}`);
  const joinTrip = partner.getByTestId('join-event');
  await expect(joinTrip).toContainText('Join Coast week', { timeout: 30_000 });
  const someoneNew = joinTrip.getByRole('button', { name: 'Someone new' });
  if ((await someoneNew.count()) > 0) await someoneNew.click();
  await joinTrip.getByLabel('Name', { exact: true }).fill('Andi');
  await joinTrip.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(partner.getByTestId('shared-event')).toBeVisible({ timeout: 60_000 });
  await openTrip(owner);
  await eventually(owner, () => expect(owner.getByTestId('shared-event')).toContainText('Andi', { timeout: 1_000 }));

  // A spending, and Budi settling up with Rina.
  await corner(owner, 'Add spending');
  await recordSharedSpend(owner, { note: 'Fish dinner', amount: '600000', paidWith: 'Rina Bank' });
  await showBalances(owner);
  await owner.getByTestId('shared-payment-row').filter({ hasText: 'Budi pays Rina' }).click();
  const settle = owner.getByTestId('settle-up');
  await settle.getByLabel('Received into').selectOption({ label: 'Rina Bank · IDR' });
  await settle.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(settle).toHaveCount(0, { timeout: 30_000 });

  // An ATM withdrawal in Family, listed on the trip with Select → Add to event.
  await openWorkspace(owner, 'Family');
  await owner.goto('/transactions');
  await owner.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(owner);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(owner, 'Rina Bank', 'From');
  await openAmount(form);
  await fillAmount(owner, form, '500000');
  await chooseTo(form, 'Rina Cash');
  await form.getByLabel('Note').fill('Harbour ATM');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // Cashflow lists only money in and out (owner 2026-11-16): the cash wallet's own history lists the withdrawal.
  await openAccountHistory(owner, 'Rina Cash');
  await expect(owner.getByTestId('transaction-row').filter({ hasText: 'Harbour ATM' })).toHaveCount(1);
  await startSelecting(owner);
  const bar = owner.getByRole('toolbar', { name: 'Selected transactions' });
  await owner.getByRole('checkbox', { name: /Harbour ATM/ }).click();
  await bar.getByRole('button', { name: 'Actions' }).click();
  await owner.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Add to event' }).click();
  await owner.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Coast week' }).click();
  // Moved into the trip: select mode ends.
  await expect(bar).toHaveCount(0, { timeout: 20_000 });

  await openTrip(owner);
  const transfer = owner.getByTestId('shared-transfer-row');
  await expect(transfer).toContainText('not counted');
  const day = owner.getByTestId('shared-event-day').filter({ has: transfer });
  await expect(day.getByTestId('shared-expense-row')).toHaveCount(1);
  await expect(day.getByTestId('shared-settlement-row')).toHaveCount(1);

  // Three kinds, one look: the same circle and line sizes, and two straight hairlines at the same inset.
  const { under: _a, height: _b, ...expenseLook } = await look(spendingRow(owner, 'Fish dinner'));
  for (const other of [day.getByTestId('shared-settlement-row'), transfer]) {
    const { under: _c, height: _d, ...rest } = await look(other);
    expect(rest).toEqual(expenseLook);
  }
  const lines = await hairlines(transfer);
  expect(lines).toHaveLength(2);
  for (const line of lines) expect(line.radius).toEqual(['0px', '0px']);
  expect(lines[1]).toEqual(lines[0]);
  if (SHOTS) await day.screenshot({ path: `${SHOTS}/2026-11-14-trip-rows-shared.png` });
  await partner.context().close();
});
