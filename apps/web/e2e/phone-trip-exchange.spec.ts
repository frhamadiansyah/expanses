import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { currencyRow, setCurrency } from './currency-field';
import { addForm, chooseTo, choosePayment, fillAmount, openAmount, saveButton, showTransfers } from './add-transaction';
import { mockRates, openWithPockets } from './pockets';
import { corner, eventually, newEvent, openTrip, openTripSettings } from './shared-events';
import { openWorkspaceSharePage, putOffShareList, shareWorkspace, workspaceLine } from './workspace-page';

/*
 * The owner's report on build 122 (trip exchange): in a shared Family workspace, a Transfer from the rupiah pocket of a
 * cash wallet into its lira pocket, at a rate above the market's (so the app keeps the spread on Currency Exchange),
 * then Select → Add to event → the shared trip → OK. Nothing happened: no reason, and the row stayed in Family.
 * Driven through the screens two phones would use. Every name and figure is invented.
 */

test.describe.configure({ timeout: 300_000 });

/** Invented: 1 TRY = 560 IDR on the market; the exchange gives 580. */
const RATES = { TRY: 560 };

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

/** Account → add a workspace, and open it. */
async function newWorkspace(page: Page, name: string) {
  await page.goto('/account');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);
}

async function openWorkspace(page: Page, name: string) {
  await page.goto('/account');
  const line = workspaceLine(page, name);
  await line.getByTestId('workspace-switch').click();
  await expect(line.getByLabel('Open', { exact: true })).toBeVisible();
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected transactions' });

/** In Family: Rp 1.450.000 out of the cash wallet's rupiah pocket, ₺ 2.500 into its lira one — 580 a lira, the market's 560. */
async function recordExchange(owner: Page) {
  await openWorkspace(owner, 'Family');
  await owner.goto('/transactions');
  await owner.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(owner);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(owner, 'Cash · IDR', 'From');
  await openAmount(form);
  await fillAmount(owner, form, '1450000');
  await chooseTo(form, 'Cash · TRY');
  await form.getByRole('button', { name: /^Received amount/ }).click();
  const keypad = owner.getByTestId('keypad');
  for (const digit of '2500') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByLabel('Note').fill('Bank Contoh');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

async function journey(owner: Page, browser: Browser, info: TestInfo, recordedBeforeSharing: boolean) {
  const husband = await secondPhone(browser, info);
  for (const phone of [owner, husband]) {
    phone.on('dialog', (dialog) => void dialog.accept());
    await mockRates(phone, RATES);
  }
  await openWithPockets(owner, { name: 'Cash', kind: 'Cash banknotes and coins', pockets: [{ currency: 'IDR', balance: '5000000' }, { currency: 'TRY', balance: '' }] });

  // Family, a workspace of its own, shared with the husband.
  await newWorkspace(owner, 'Family');
  if (recordedBeforeSharing) await recordExchange(owner);
  await openWorkspaceSharePage(owner, 'Family');
  const code = await shareWorkspace(owner, 'Ayu');
  await husband.goto(`/join#${code}`);
  const join = husband.getByTestId('join-workspace');
  await expect(join.getByText('Family', { exact: true })).toBeVisible({ timeout: 30_000 });
  await join.getByLabel('Name').fill('Bima');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(join).toHaveCount(0, { timeout: 60_000 });
  await putOffShareList(owner);

  // The trip, shared in lira with the husband alone.
  await newEvent(owner, 'Anatolia Trip');
  await corner(owner, 'Share this event');
  const share = owner.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Ayu');
  await setCurrency(currencyRow(share, 'Currency'), 'TRY');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const link = (await owner.getByTestId('invite-link').textContent({ timeout: 60_000 }))!.trim();
  await husband.goto(`/join#${link.replace('cicis://join/', '')}`);
  const joinTrip = husband.getByTestId('join-event');
  await expect(joinTrip).toContainText('Join Anatolia Trip', { timeout: 30_000 });
  const someoneNew = joinTrip.getByRole('button', { name: 'Someone new' });
  if ((await someoneNew.count()) > 0) await someoneNew.click();
  await joinTrip.getByLabel('Name', { exact: true }).fill('Bima');
  await joinTrip.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(husband.getByTestId('shared-event')).toBeVisible({ timeout: 60_000 });
  await openTrip(owner, 'Anatolia Trip');
  // Shared with the husband alone, the trip is one pot (no Balances card to name him): his name is on its Settings page.
  const settings = await openTripSettings(owner);
  await eventually(owner, () => expect(settings.getByTestId('shared-settings-people')).toContainText('Bima', { timeout: 1_000 }));
  await expect(settings.getByRole('checkbox', { name: 'Split costs' })).not.toBeChecked();

  if (!recordedBeforeSharing) await recordExchange(owner);
  await openWorkspace(owner, 'Family');
  await owner.goto('/transactions');
  // An own transfer (cash to cash) is off Cashflow until its filter shows transfers (own transfers off Cashflow).
  await showTransfers(owner);

  const row = owner.getByTestId('transaction-row').filter({ hasText: 'Bank Contoh' });
  await expect(row).toHaveCount(1);
  await owner.screenshot({ path: info.outputPath('before.png') });
  // What its receipt says, kept with the run: the owner's read "Paid with Cash · IDR + Currency Exchange + Cash · TRY".
  await row.first().click();
  await owner.screenshot({ path: info.outputPath('receipt.png') });
  await owner.goBack();
  await expect(row).toHaveCount(1);

  // Select → tick it → Add to event → the trip → OK (the confirm is accepted).
  await owner.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(bar(owner)).toBeVisible();
  await owner.getByRole('checkbox', { name: /Bank Contoh/ }).click();
  await expect(bar(owner)).toContainText('1 selected');
  await bar(owner).getByRole('button', { name: 'Actions' }).click();
  await owner.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Add to event' }).click();
  await owner.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Anatolia Trip' }).click();

  // Either it left Family, or the bar says why it stayed.
  await expect(async () => {
    const gone = (await row.count()) === 0;
    const said = (await bar(owner).getByRole('alert').count()) + (await owner.getByText(/stayed where/).count()) > 0;
    expect(gone || said).toBe(true);
  }).toPass({ timeout: 20_000 });
  await owner.screenshot({ path: info.outputPath('after.png') });
  return row;
}

test('a lira exchange in a shared Family workspace, Add to event into the shared trip: it leaves Family and is listed on the trip', async ({ page: owner, browser }, info) => {
  const row = await journey(owner, browser, info, false);
  await expect(row).toHaveCount(0);
  await openTrip(owner, 'Anatolia Trip');
  await expect(owner.getByTestId('shared-event')).toContainText('Bank Contoh');
});

/*
 * The owner's own row: recorded in Family before Family sent its transfers to the household as redacted rows, so it is
 * filed there as a purchase — its receipt reads "Paid with Cash · IDR + Currency Exchange + Cash · TRY". Build 122 kept
 * it in Family ("Recorded before Family sent its transfers …"); now it is filed as a transfer and listed on the trip.
 */
test('the owner’s row, filed in Family as a purchase before Family sent its transfers: Add to event lists it on the trip', async ({ page: owner, browser }, info) => {
  const row = await journey(owner, browser, info, true);
  await expect(row).toHaveCount(0);
  await expect(bar(owner)).toHaveCount(0);
  await openTrip(owner, 'Anatolia Trip');
  await expect(owner.getByTestId('shared-event')).toContainText('Bank Contoh');
});
