import { expect, type Page, test } from '@playwright/test';
import { openAccount, openWalletAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { mockRates } from './pockets';
import { inject, notice } from './capture';
import { corner, recordSharedSpend, sharedCard, spendingRow } from './shared-events';

/*
 * Event mode (mockup docs/mockups/2026-11-12-event-mode.html, screens 1, 2E, 2F, 3 and 4's toast): turned on from the
 * event, every new transaction goes to it by itself until the day after Until. Names, amounts and rates are invented.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Noon on a day, the browser's own clock: the mode reads "today" off it. */
const on = (day: string) => new Date(`${day}T12:00:00`);

async function newTrip(page: Page, name: string, o: { from: string; to: string; currency?: string }) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (o.currency) {
    await page.getByRole('button', { name: 'Currency: IDR' }).click();
    await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${o.currency} `) }).first().click();
  }
  await page.getByLabel('Starts on').fill(o.from);
  await page.getByLabel('Ends on').fill(o.to);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** The Add screen from the tab bar's ＋, filled and saved; `leaveOut` presses the chip's ✕ first. */
async function addSpend(page: Page, o: { note: string; amount: string; paidWith: string; leaveOut?: string }) {
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  const form = addForm(page);
  await expect(form).toBeVisible();
  if (o.leaveOut) {
    await form.getByRole('button', { name: `Leave this one out of ${o.leaveOut}` }).click();
    await expect(form.getByTestId('event-chip')).toHaveCount(0);
  }
  await openAmount(form);
  await fillAmount(page, form, o.amount);
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, o.paidWith);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill(o.note);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

const row = (page: Page, note: string) => page.getByTestId('transaction-row').filter({ hasText: note });

test('event mode: on from the event, a dot and a menu row on Cashflow, the Add form in the trip, off with Undo, ended by itself with Keep on', async ({ page }) => {
  await page.clock.setSystemTime(on('2026-11-14'));
  await mockRates(page, { TRY: 400 });
  await openAccount(page, { subtype: 'cash', name: 'Lira cash', currency: 'TRY' });
  await newTrip(page, 'Lake trip', { from: '2026-11-12', to: '2026-11-16', currency: 'TRY' });

  // Screen 1: the switch, then Until (the event's end) and Add in (its currency), and what happens next under them.
  const group = page.getByTestId('event-mode-group');
  await expect(group).toContainText('New transactions go to Lake trip');
  await group.getByTestId('event-mode-switch').check();
  await expect(group.getByLabel('Until')).toHaveValue('2026-11-16');
  await expect(group.getByRole('button', { name: 'Add in: TRY' })).toBeVisible();
  await expect(group).toContainText('Ends by itself after 16 Nov. Turning it on for another event turns this one off.');

  // 2E: the workspace button wears the purple round; 2F: its menu opens with the trip on top, a tap to the event.
  await page.goto('/transactions');
  await expect(page.getByTestId('event-mode-dot').first()).toBeVisible();
  await page.getByRole('button', { name: /^Workspace, .*event mode on for Lake trip$/ }).first().click();
  const top = page.getByTestId('workspace-menu').getByTestId('event-mode-menu-row');
  await expect(top).toContainText('Lake trip');
  await expect(top).toContainText('Event mode until 16 Nov');
  await top.click();
  await expect(page).toHaveURL(/\/events\/[^/]+$/);
  await expect(page.getByTestId('event-mode-switch')).toBeChecked();

  // Screen 3: the Add form opens in the trip — the chip on top — and in lira.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  const form = addForm(page);
  await expect(form.getByTestId('event-chip')).toContainText('Lake trip');
  await expect(form.getByRole('button', { name: 'Currency' })).toContainText('🇹🇷');
  await page.goBack();
  await addSpend(page, { note: 'Lakeside lunch', amount: '650', paidWith: 'Lira cash' });
  // Cashflow leaves an event's spending to the event's own card (₺650 at Rp 400 is Rp 260.000)…
  await expect(page.getByRole('link', { name: /^Lake trip/ })).toContainText('260.000');

  // ✕ on the chip leaves that one transaction out; the next one is in the trip again.
  await addSpend(page, { note: 'Corner shop', amount: '120', paidWith: 'Lira cash', leaveOut: 'Lake trip' });
  await expect(row(page, 'Corner shop')).toBeVisible();
  await expect(row(page, 'Corner shop').getByTestId('row-event')).toHaveCount(0);

  // …and every list that shows it marks it with a plane on its icon, the grey line left as any row's: the account's own history.
  await openWalletAccount(page, 'Lira cash');
  const recent = page.getByTestId('account-recent');
  await expect(recent.getByRole('button', { name: /Lakeside lunch/ })).toHaveAccessibleName('Groceries Lakeside lunch · Lira cash · Lake trip');
  await expect(recent.getByTestId('row-event')).toHaveCount(1);
  await expect(recent.getByTestId('row-event')).toHaveAttribute('title', 'Lake trip');
  await expect(recent.getByRole('button', { name: /Corner shop/ })).toHaveAccessibleName('Groceries Corner shop · Lira cash');
  // On the trip's own page every row is the trip's: no plane on any of them.
  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Lake trip' }).click();
  await expect(page.getByTestId('event-history').filter({ hasText: 'Lakeside lunch' })).toBeVisible();
  await expect(page.getByTestId('event-history').getByTestId('row-event')).toHaveCount(0);

  // Off by hand, from the event: the light Undo bar puts it back.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Workspace, / }).first().click();
  await page.getByTestId('event-mode-menu-row').click();
  const toggle = page.getByTestId('event-mode-switch');
  await toggle.uncheck();
  await expect(page.getByTestId('event-mode-undo')).toContainText('Event mode off');
  await expect(page.getByTestId('event-mode-group').getByLabel('Until')).toHaveCount(0);
  await page.getByTestId('event-mode-undo').getByRole('button', { name: 'Undo' }).click();
  await expect(toggle).toBeChecked();

  // The day after Until it is off by itself: the next open says so, and Keep on gives it one more day.
  await page.clock.setSystemTime(on('2026-11-17'));
  await page.goto('/transactions');
  const ended = page.getByTestId('event-mode-ended');
  await expect(ended).toContainText('Event mode for Lake trip ended');
  await expect(page.getByTestId('event-mode-dot')).toHaveCount(0);
  await ended.getByRole('button', { name: 'Keep on' }).click();
  await expect(page.getByTestId('event-mode-dot').first()).toBeVisible();
  await page.getByRole('button', { name: /^Workspace, / }).first().click();
  await expect(page.getByTestId('event-mode-menu-row')).toContainText('Event mode until 17 Nov');
});

test('event mode from the Events list: hold an event, and turning it on for another turns the first off', async ({ page }) => {
  await page.clock.setSystemTime(on('2026-11-14'));
  await newTrip(page, 'Lake trip', { from: '2026-11-12', to: '2026-11-16' });
  await newTrip(page, 'Hill weekend', { from: '2026-11-14', to: '2026-11-15' });

  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Lake trip' }).click({ button: 'right' });
  await page.getByRole('dialog', { name: 'Lake trip' }).getByTestId('event-mode-switch').check();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/events$/);

  await page.getByTestId('event-row').filter({ hasText: 'Hill weekend' }).click({ button: 'right' });
  const hill = page.getByRole('dialog', { name: 'Hill weekend' });
  await hill.getByTestId('event-mode-switch').check();
  await expect(hill.getByLabel('Until')).toHaveValue('2026-11-15');
  await page.keyboard.press('Escape');

  // One event at a time: Lake trip's switch is off now.
  await page.getByTestId('event-row').filter({ hasText: 'Lake trip' }).click({ button: 'right' });
  await expect(page.getByRole('dialog', { name: 'Lake trip' }).getByTestId('event-mode-switch')).not.toBeChecked();
});

test('event mode in a shared event: the Add form says who it is shared with, and the spending reaches the event', async ({ page }) => {
  test.setTimeout(180_000);
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '5000000' });
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await newTrip(page, 'Coast week', { from: today, to: today });
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });

  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Coast week' }).click();
  await expect(page.getByTestId('shared-event')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('event-mode-switch').check();

  // The plain ＋ opens the event's own card, exactly as picking the event on the Event row does, with the chip on top.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  const card = sharedCard(page);
  await expect(card.getByTestId('event-chip')).toContainText('Coast week');
  await expect(card.getByTestId('event-chip-shared')).toHaveText('Shared with Budi');
  await recordSharedSpend(page, { note: 'Boat ride', amount: '300000', paidWith: 'Rina Bank' });

  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Coast week' }).click();
  await expect(spendingRow(page, 'Boat ride')).toContainText('Rina paid');

  // An account's Spend (its address: Expense, that account) opens the event's card with that account paying (fix round 1).
  await openWalletAccount(page, 'Rina Bank');
  const accountId = new URL(page.url()).pathname.split('/').pop()!;
  await page.goto(`/transactions/new?mode=expense&account=${accountId}`);
  await expect(card.getByTestId('event-chip')).toContainText('Coast week');
  await expect(card.getByRole('button', { name: /^Payment method/ })).toContainText('Rina Bank');
  await page.goBack();

  // One line: saved untagged, then moved in; the saved row opens the event's own record (fix round 1, H2 and the saved row).
  await page.goto('/transactions/line');
  await expect(page.getByTestId('event-chip')).toContainText('Shared with Budi');
  await page.getByLabel('One line', { exact: true }).fill('kiosk 25rb rina bank');
  await page.getByLabel('One line', { exact: true }).press('Enter');
  const savedRow = page.getByTestId('line-saved-row').filter({ hasText: 'Kiosk' });
  await expect(savedRow).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await savedRow.click();
  await expect(page).toHaveURL(/expense=/);
  await expect(sharedCard(page)).toBeVisible();

  // A capture arrives picked for the shared event: To review names it, a swipe would not record it silently, and its form
  // carries the chip with who will see it (fix round 1).
  await inject(page, [notice({ id: 'note-coast', capturedAt: await page.evaluate(() => new Date().toISOString()), body: 'Pembayaran Rp38.000 berhasil. Merchant: PANTAI KIOSK' })]);
  await page.goto('/review');
  const draft = page.getByTestId('draft-row').filter({ hasText: 'PANTAI KIOSK' });
  await expect(draft.getByTestId('row-event')).toHaveAttribute('title', 'Coast week');
  await expect(draft).not.toContainText('Coast week · ');
  await draft.click();
  await expect(page.getByTestId('event-chip')).toContainText('Coast week');
  await expect(page.getByTestId('event-chip-shared')).toHaveText('Shared with Budi');
});
