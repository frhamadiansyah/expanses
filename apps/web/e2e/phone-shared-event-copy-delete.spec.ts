import { type Browser, expect, type Page, test, type TestInfo } from '@playwright/test';
import { currencyRow, setCurrency } from './currency-field';
import { mockRates } from './pockets';
import { corner, newEvent, openTrip, openTripSettings, showBalances } from './shared-events';

/*
 * Delete this copy (owner report 2026-11-12): Andi leaves "Coast week", his phone keeps it read-only, and Delete this
 * copy takes it off his phone alone — Rina's trip is untouched. Every figure is invented.
 */

test.describe.configure({ timeout: 300_000 });

async function secondPhone(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor, userAgent: use.userAgent });
  return context.newPage();
}

test('a left trip is read-only on Andi’s phone, and Delete this copy takes it off that phone alone', async ({ page: rina, browser }, info) => {
  const andi = await secondPhone(browser, info);
  const asked: string[] = [];
  for (const phone of [rina, andi]) {
    phone.on('dialog', (dialog) => {
      asked.push(dialog.message());
      void dialog.accept();
    });
    await mockRates(phone, { TRY: 560 });
  }

  await newEvent(rina, 'Coast week');
  await corner(rina, 'Share this event');
  const share = rina.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await setCurrency(currencyRow(share, 'Currency'), 'TRY');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  const link = (await rina.getByTestId('invite-link').textContent({ timeout: 60_000 }))!.trim();

  await andi.goto(`/join#${link.replace('cicis://join/', '')}`);
  const join = andi.getByTestId('join-event');
  await expect(join).toContainText('Join Coast week', { timeout: 30_000 });
  await join.getByRole('button', { name: 'Someone new' }).click();
  await join.getByLabel('Name', { exact: true }).fill('Andi');
  await join.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(andi.getByTestId('shared-event')).toBeVisible({ timeout: 60_000 });

  // A live trip offers Leave, never Delete this copy.
  const settings = await openTripSettings(andi);
  await expect(settings.getByRole('button', { name: /^Leave/ })).toBeVisible();
  await expect(settings.getByRole('button', { name: /^Delete this copy/ })).toHaveCount(0);
  await settings.getByRole('button', { name: /^Leave/ }).click();
  await expect(settings.getByRole('button', { name: /^Delete this copy/ })).toBeVisible({ timeout: 60_000 });
  await openTrip(andi);
  await showBalances(andi);
  await expect(andi.getByTestId('shared-event-read-only')).toContainText('Andi is no longer in Coast week', { timeout: 60_000 });

  await corner(andi, 'Delete this copy');
  await expect(andi).toHaveURL(/\/events$/, { timeout: 30_000 });
  expect(asked).toContain('Delete this copy of Coast week? Andi is no longer in it. What was recorded stays with the others.');
  await expect(andi.getByTestId('event-row').filter({ hasText: 'Coast week' })).toHaveCount(0);

  // Rina's trip is as it was.
  await openTrip(rina);
  await showBalances(rina);
  await expect(rina.getByTestId('shared-event-read-only')).toHaveCount(0);
});
