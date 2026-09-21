import { expect, type Page } from '@playwright/test';

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
