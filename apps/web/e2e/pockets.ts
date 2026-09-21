import { readFileSync, writeFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';

/** Frankfurter answers only for the codes given, at the rates given; everything else fails, as offline would. */
export async function mockRates(page: Page, rates: Record<string, number>) {
  await page.route('https://api.frankfurter.dev/**', (route) => {
    const url = new URL(route.request().url());
    const base = url.searchParams.get('base') ?? '';
    const rate = rates[base];
    if (rate === undefined) return route.abort();
    return route.fulfill({ json: [{ date: url.searchParams.get('date'), base, quote: url.searchParams.get('quotes'), rate }] });
  });
}

/** Opens an account with pockets through Add account, typing every figure one key at a time. */
export async function openWithPockets(
  page: Page,
  account: { name: string; kind?: string; bank?: string; pockets: { currency: string; balance: string; rate?: string }[] },
) {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: account.kind ?? 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially(account.name);
  if (account.bank) await page.getByLabel('Bank', { exact: true }).pressSequentially(account.bank);
  await page.getByLabel('Holds more than one currency').check();
  for (let i = 2; i < account.pockets.length; i += 1) await page.getByRole('button', { name: 'Add another currency' }).click();
  for (const [i, pocket] of account.pockets.entries()) {
    await page.getByLabel(`Pocket ${i + 1}`, { exact: true }).selectOption(pocket.currency);
    await page.getByLabel(`Opening ${pocket.currency}`, { exact: true }).pressSequentially(pocket.balance);
    if (pocket.rate) await page.getByLabel(new RegExp(`^Rate: \\w+ per 1 ${pocket.currency}$`)).pressSequentially(pocket.rate);
  }
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: account.name, exact: true })).toBeVisible();
}

/**
 * Forgets every exchange rate the device holds, through the app's own backup and restore — the only way to leave a
 * funded foreign account with no rate at all, since opening one with a balance always stores the rate it opened at.
 * Pair it with an aborted rate route, so nothing can be fetched back.
 */
export const forgetRates = (page: Page, target: string) => rewriteRates(page, target, 'DELETE FROM fx_rates');

/**
 * Moves every rate the device holds back one day, so today's are only last-known: what a device sees on the first
 * screen of the day, before anything has fetched the day's rates.
 */
export const ageRates = (page: Page, target: string) => rewriteRates(page, target, "UPDATE fx_rates SET on_date = date(on_date, '-1 day')");

/** Runs one statement on the stored rates through a backup and a restore. */
async function rewriteRates(page: Page, target: string, statement: string) {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  writeFileSync(target, readFileSync((await (await downloaded).path())!));
  const db = new BetterSqlite3(target);
  db.prepare(statement).run();
  db.close();

  // The restore's confirm is accepted by the spec's own `dialog` handler (every spec using this has one).
  const safety = page.waitForEvent('download');
  await page.locator('input[accept*="sqlite3"]').setInputFiles(target);
  await safety;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
}
