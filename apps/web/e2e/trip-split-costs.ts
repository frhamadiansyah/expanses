import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { corner, newEvent, openTrip, openTripSettings, recordSharedSpend, sharedCard, showCard, spendingRow } from './shared-events';

/*
 * A shared trip's Split costs and Plan switches (owner, 14 Nov 2026), one journey for both shells: the bar's ＋ and ⚙,
 * the Settings page, Split costs off with Budi owing (asked first), the trip in one pot, the Add screen with no Split
 * row, Plan off leaving one card with no dots, and both switched back on. One phone: Budi is a name without the app, so
 * there is something owed. Invented names and figures. With `shots` set, the 390px screens go there.
 */
export async function splitCostsJourney(page: Page, shots?: string) {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '90000000' });
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);

  // The bar: ＋ and ⚙, as a private trip's; no ⋯.
  const trip = page.getByTestId('shared-event');
  await expect(trip.getByRole('button', { name: 'Add spending', exact: true })).toBeVisible();
  await expect(trip.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^More$/ })).toHaveCount(0);

  // A dinner split with Budi: Budi owes Rina half.
  await corner(page, 'Add spending');
  await expect(sharedCard(page).getByRole('button', { name: /^Split/ })).toBeVisible();
  await recordSharedSpend(page, { note: 'Fish dinner', amount: '480000', paidWith: 'Rina Bank' });
  await expect(spendingRow(page, 'Fish dinner')).toContainText(/share Rp\s?240\.000/);
  await expect(page.getByTestId('hero-dots').getByRole('button')).toHaveCount(3);

  // Settings: both switches on, People and Categories, Mark as done, Leave last (greyed: Rina is owed).
  let settings = await openTripSettings(page);
  const split = settings.getByRole('checkbox', { name: 'Split costs' });
  const plan = settings.getByRole('checkbox', { name: 'Plan' });
  await expect(split).toBeChecked();
  await expect(plan).toBeChecked();
  await expect(settings).toContainText('Split costs off: one pot, no shares or settling up.');
  await expect(settings.getByRole('button', { name: /^People/ })).toContainText('Rina, Budi');
  await expect(settings.getByRole('button', { name: 'Mark as done', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Leave Coast week', exact: true })).toBeDisabled();
  await expect(settings).toContainText("Rina's balance is not zero yet.");
  if (shots) await page.screenshot({ path: `${shots}/2026-11-14-trip-split-costs-settings.png` });

  // Off with Budi owing asks first; Cancel keeps it on.
  await split.click({ force: true });
  const ask = page.getByRole('alertdialog', { name: 'Stop splitting costs?' });
  await expect(ask).toContainText(/Budi owes Rina Rp\s?240\.000 now\. With splitting off, nobody owes anything on this trip\./);
  if (shots) await page.screenshot({ path: `${shots}/2026-11-14-trip-split-costs-confirm.png` });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await expect(split).toBeChecked();
  await split.click({ force: true });
  await page.getByRole('alertdialog', { name: 'Stop splitting costs?' }).getByRole('button', { name: 'Stop splitting' }).click();
  await expect(split).not.toBeChecked();
  await expect(settings).toContainText("Rina's balance is not zero yet. Split costs on shows it.");

  // The trip in one pot: Spending and Plan only, the row says who paid and with what, no share.
  await page.getByRole('link', { name: 'Coast week' }).first().click();
  await expect(trip).toBeVisible();
  await expect(page.getByTestId('hero-dots').getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('hero-slide-balances')).toHaveCount(0);
  await expect(spendingRow(page, 'Fish dinner')).toContainText('Fish dinner · Rina · Rina Bank');
  await expect(spendingRow(page, 'Fish dinner')).not.toContainText('share');

  // The Add screen in one pot: no Split row.
  await corner(page, 'Add spending');
  await expect(sharedCard(page)).toBeVisible({ timeout: 30_000 });
  await expect(sharedCard(page).getByRole('button', { name: /^Split/ })).toHaveCount(0);
  await expect(sharedCard(page).getByRole('button', { name: /^Paid by/ })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/2026-11-14-trip-split-costs-add.png` });
  await recordSharedSpend(page, { note: 'Boat ride', amount: '150000', paidWith: 'Rina Bank' });
  await expect(spendingRow(page, 'Boat ride')).toContainText('Boat ride · Rina · Rina Bank');
  if (shots) await page.screenshot({ path: `${shots}/2026-11-14-trip-split-costs-trip-off.png` });

  // Plan off too: one card, no dots, nothing to swipe.
  settings = await openTripSettings(page);
  await settings.getByRole('checkbox', { name: 'Plan' }).click({ force: true });
  await expect(settings.getByRole('checkbox', { name: 'Plan' })).not.toBeChecked();
  await page.getByRole('link', { name: 'Coast week' }).first().click();
  await expect(trip).toBeVisible();
  await expect(page.getByTestId('hero-dots')).toHaveCount(0);
  await expect(page.getByTestId('hero-slide-spending')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/2026-11-14-trip-split-costs-one-card.png` });

  // Both back on: the split recorded before comes back, Budi still owes Rina; the boat is Rina's alone.
  settings = await openTripSettings(page);
  await settings.getByRole('checkbox', { name: 'Split costs' }).click({ force: true });
  await settings.getByRole('checkbox', { name: 'Plan' }).click({ force: true });
  await expect(settings.getByRole('checkbox', { name: 'Split costs' })).toBeChecked();
  await expect(settings.getByRole('checkbox', { name: 'Plan' })).toBeChecked();
  await page.getByRole('link', { name: 'Coast week' }).first().click();
  await expect(page.getByTestId('hero-dots').getByRole('button')).toHaveCount(3);
  await expect(spendingRow(page, 'Fish dinner')).toContainText(/share Rp\s?240\.000/);
  await expect(spendingRow(page, 'Boat ride')).toContainText(/share Rp\s?150\.000/);
  await showCard(page, 'Balances');
  await expect(page.getByTestId('shared-payment-row')).toHaveText([/Budi pays Rina Rp\s?240\.000/]);
}
