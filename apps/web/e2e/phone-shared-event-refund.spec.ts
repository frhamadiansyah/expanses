import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, openAmount, saveButton } from './add-transaction';
import { mockRates } from './pockets';
import { corner, eventually, newEvent, openTrip, recordSharedSpend, spendingRow } from './shared-events';
import { openWorkspaceSharePage } from './workspace-page';

/*
 * A refund for a purchase of a shared event (the owner's report: a refund to the card was missing on the partner's
 * phone). Rina pays a fish dinner for the event; the refund of part of it lands back on her bank; moved into the event
 * with Select → Add to event it becomes a row below zero on both phones, with the same total. Invented figures:
 * 1 TRY = 560 IDR.
 */

test.describe.configure({ timeout: 300_000 });

const RATES = { TRY: 560 };

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

test('a refund moved into a shared event shows on both phones with the same rows and total', async ({ page: rina, browser }, info) => {
  const andi = await secondPhone(browser, info);
  for (const phone of [rina, andi]) {
    phone.on('dialog', (dialog) => void dialog.accept());
    await mockRates(phone, RATES);
  }
  await openAccount(rina, { subtype: 'bank', name: 'Rina Bank', balance: '10000000' });
  await openAccount(andi, { subtype: 'bank', name: 'Andi Bank', balance: '10000000' });

  await newEvent(rina, 'Coast week');
  await corner(rina, 'Share this event');
  const share = rina.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Currency').selectOption('TRY');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const link = (await rina.getByTestId('invite-link').textContent({ timeout: 60_000 }))!.trim();
  await andi.goto(`/join#${link.replace('cicis://join/', '')}`);
  const join = andi.getByTestId('join-event');
  await expect(join).toContainText('Join Coast week', { timeout: 30_000 });
  await join.getByRole('button', { name: 'Someone new' }).click();
  await join.getByLabel('Name', { exact: true }).fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(andi.getByTestId('shared-event')).toBeVisible({ timeout: 60_000 });

  // Rina hears that Andi joined before she records, so he is in the split.
  await rina.goto('/account');
  await openWorkspaceSharePage(rina, 'Personal');
  await eventually(rina, () => expect(rina.getByTestId('share-event-row').first()).toContainText('Shared with 2 people', { timeout: 1_000 }));

  // Rina pays ₺900 for the fish dinner from her bank (Rp 504.000), shared by all three.
  await openTrip(rina);
  await corner(rina, 'Add spending');
  await recordSharedSpend(rina, { note: 'Fish dinner', amount: '900', paidWith: 'Rina Bank', charged: { currency: 'IDR', amount: '504000' } });
  await expect(spendingRow(rina, 'Fish dinner')).toBeVisible();

  // Part of it comes back to her bank: Rp 168.000 (₺300), typed as money back.
  await rina.goto('/transactions');
  await rina.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(rina);
  await openAmount(form);
  const keypad = rina.getByTestId('keypad');
  for (const key of ['−', ...'168000']) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(rina, 'Rina Bank', 'Into');
  await form.getByRole('button', { name: /^Category/ }).click();
  await rina.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Refund · Fish dinner');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Select the refund, Add to event: it leaves the workspace and joins the event's spending below zero.
  await rina.getByRole('button', { name: 'Select', exact: true }).click();
  const bar = rina.getByRole('toolbar', { name: 'Selected transactions' });
  await rina.getByRole('checkbox', { name: 'Select Refund · Fish dinner' }).click();
  await bar.getByRole('button', { name: 'Actions' }).click();
  await rina.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Add to event' }).click();
  await rina.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Coast week' }).click();
  await expect(bar).toHaveCount(0, { timeout: 30_000 });

  // Rina's page: two rows, the refund below zero, the total ₺600.
  await openTrip(rina);
  await expect(rina.getByTestId('shared-expense-row')).toHaveCount(2);
  await expect(spendingRow(rina, 'Refund · Fish dinner')).toContainText(/[−-]Rp\s168\.000/);
  const total = rina.getByTestId('shared-event-total');
  await expect(total).toContainText(/\b600\b/);

  // Andi's phone: the same two rows and the same total, his share reduced.
  await openTrip(andi);
  await eventually(andi, () => expect(spendingRow(andi, 'Refund · Fish dinner')).toBeVisible({ timeout: 1_000 }));
  await expect(andi.getByTestId('shared-expense-row')).toHaveCount(2);
  await expect(andi.getByTestId('shared-event-total')).toContainText(/\b600\b/);
  await expect(spendingRow(andi, 'Refund · Fish dinner')).toContainText('Rina paid');
  await expect(spendingRow(andi, 'Refund · Fish dinner')).toContainText(/share [−-]Rp\s56\.000/);
  expect(await andi.getByTestId('shared-event-total').textContent()).toBe(await total.textContent());
});
