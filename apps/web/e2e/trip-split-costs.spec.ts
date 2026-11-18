import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { corner, newEvent, openTrip, openTripSettings, recordSharedSpend, sharedCard, showBalances, spendingRow } from './shared-events';

/*
 * A shared trip's Split costs and Plan switches on the Mac event page (owner, 14 Nov 2026; Mac Events 18 Nov 2026): the
 * title bar's ＋ Add spending and ⚙, the Split costs box (what each person paid, Half each, who pays whom with Settle up),
 * Split costs off asked first and the trip then in one pot (no box, no share), Plan off dropping the Plan box and tab,
 * both back on, and a settle-up recorded from the box. One phone: Budi is a name without the app, so something is owed.
 * Invented names and figures. The phone's own journey of the same switches is phone-trip-split-costs.spec.ts.
 */

test.describe.configure({ timeout: 240_000 });

const splitBox = (page: Page) => page.getByTestId('split-costs');
const backToTrip = (page: Page) => page.getByRole('link', { name: 'Coast week' }).first().click();

test('a shared trip on the Mac page: paid by each, Half each and Budi pays Rina with Settle up; one pot drops the box and the shares, Plan off its tab, both back on', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '90000000' });
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);

  // The bar: ＋ Add spending and ⚙, the Shared chip naming Budi; no ⋯.
  const trip = page.getByTestId('shared-event');
  await expect(trip.getByRole('button', { name: 'Add spending', exact: true })).toBeVisible();
  await expect(trip.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(trip.getByTestId('event-shared-chip')).toHaveText('Shared · Budi');
  await expect(page.getByRole('button', { name: /^More$/ })).toHaveCount(0);

  // A dinner split with Budi: Budi owes Rina half.
  await corner(page, 'Add spending');
  await expect(sharedCard(page).getByRole('button', { name: /^Split/ })).toBeVisible();
  await recordSharedSpend(page, { note: 'Fish dinner', amount: '480000', paidWith: 'Rina Bank' });
  await expect(trip).toBeVisible();
  await expect(spendingRow(page, 'Fish dinner')).toContainText(/share Rp\s?240\.000/);
  await expect(spendingRow(page, 'Fish dinner')).toContainText('Rina Bank');

  // Split costs: Rina (this phone) first, the two paid figures adding up to the ring's total; Half each; Budi pays Rina.
  await expect(page.getByTestId('event-ring').getByTestId('period-total')).toHaveText(/^Rp\s?480\.000$/);
  await expect(splitBox(page).getByTestId('split-paid-by')).toHaveText([/Paid by Rina\s*Rp\s?480\.000/, /Paid by Budi\s*Rp\s?0/]);
  await expect(splitBox(page).getByTestId('split-rule')).toHaveText(/^Half each\s*Rp\s?240\.000$/);
  await expect(page.getByTestId('shared-payment-row')).toHaveText([/^Budi pays Rina Rp\s?240\.000\s*Settle up$/]);

  // Settings: Split costs off with Budi owing asks first; Stop splitting puts the trip in one pot.
  let settings = await openTripSettings(page);
  await settings.getByRole('checkbox', { name: 'Split costs' }).click({ force: true });
  await page.getByRole('alertdialog', { name: 'Stop splitting costs?' }).getByRole('button', { name: 'Stop splitting' }).click();
  await expect(settings.getByRole('checkbox', { name: 'Split costs' })).not.toBeChecked();
  await backToTrip(page);
  await expect(trip).toBeVisible();
  await expect(splitBox(page)).toHaveCount(0);
  await expect(page.getByTestId('shared-payment-row')).toHaveCount(0);
  await expect(spendingRow(page, 'Fish dinner')).not.toContainText('share');

  // Plan off too: no Plan tab.
  await expect(page.getByRole('tab', { name: /^Plan · / })).toHaveCount(1);
  settings = await openTripSettings(page);
  await settings.getByRole('checkbox', { name: 'Plan' }).click({ force: true });
  await expect(settings.getByRole('checkbox', { name: 'Plan' })).not.toBeChecked();
  await backToTrip(page);
  await expect(trip).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Plan · / })).toHaveCount(0);

  // Both back on: the split recorded before comes back, Budi still owes Rina.
  settings = await openTripSettings(page);
  await settings.getByRole('checkbox', { name: 'Split costs' }).click({ force: true });
  await settings.getByRole('checkbox', { name: 'Plan' }).click({ force: true });
  await expect(settings.getByRole('checkbox', { name: 'Split costs' })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Plan' })).toBeChecked();
  await backToTrip(page);
  await expect(splitBox(page).getByTestId('split-rule')).toHaveText(/^Half each\s*Rp\s?240\.000$/);
  await expect(page.getByRole('tab', { name: /^Plan · / })).toHaveCount(1);
  await expect(spendingRow(page, 'Fish dinner')).toContainText(/share Rp\s?240\.000/);

  // The phone reads the same trip: Budi pays Rina Rp 240.000 under Balances.
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrip(page);
  await showBalances(page);
  await expect(page.getByTestId('shared-payment-row')).toHaveText([/Budi pays Rina Rp\s?240\.000/]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTrip(page);

  // Settle up from the box: today's sheet; recorded, nobody owes anything and the settle-up is a row of the table.
  await splitBox(page).getByRole('button', { name: /^Settle up: Budi pays Rina/ }).click();
  const settle = page.getByTestId('settle-up');
  await settle.getByLabel('Received into').selectOption({ label: 'Rina Bank · IDR' });
  await settle.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(settle).toHaveCount(0, { timeout: 30_000 });
  await expect(splitBox(page).getByTestId('split-settled')).toHaveText('Nobody owes anything.');
  await expect(page.getByTestId('shared-settlement-row')).toContainText('Budi paid Rina');
});
