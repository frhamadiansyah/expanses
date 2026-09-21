import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/**
 * The IDX list is an empty placeholder until the exchange's Daftar Saham arrives (Task 3's IDX half). While it is, a
 * walk that finds BBCA on the list names it instead — the same stock, market, currency and lot size, typed through
 * Name it myself — and the assertions that need the list itself wait, exactly as the catalogue's own tests do.
 */
export const idxPending =
  (JSON.parse(readFileSync(new URL('../../../packages/catalog/securities/idx.json', import.meta.url), 'utf8')) as { rows: unknown[] }).rows.length === 0;

/** BBCA as the IDX list carries it, for Name it myself while the list is pending. */
export const BBCA_BY_HAND = { ticker: 'BBCA', name: 'BCA', market: 'IDX', currency: 'IDR', lotSize: '100' };

/** The owner's preview switch (developer settings, linked from nowhere): the US list, granted on this device. */
export async function setForeignList(page: Page, on: boolean) {
  await page.goto('/settings/developer');
  const box = page.getByLabel('US ticker list');
  if (on) await box.check();
  else await box.uncheck();
  await expect(box).toBeChecked({ checked: on });
}

export interface NameIt {
  ticker: string;
  name: string;
  market: string;
  currency: string;
  lotSize?: string;
}

/** Search, pick, and fill the Add a holding form by keystroke. Money options read `Name (CUR)`, as the form draws them. */
export async function addHoldingFlow(
  page: Page,
  o: {
    search: string;
    pick?: string;
    nameIt?: NameIt;
    broker: string | { new: string; currency?: string };
    quantity: string;
    price: string;
    fee?: string;
    paidFrom: string;
    charged?: string;
  },
) {
  await page.goto('/net-worth/investments/new');
  await page.getByLabel('Ticker or name').pressSequentially(o.search);
  if (o.nameIt) {
    await page.getByRole('button', { name: /Name it myself/ }).click();
    await page.getByLabel('Ticker', { exact: true }).pressSequentially(o.nameIt.ticker);
    await page.getByLabel('Name', { exact: true }).pressSequentially(o.nameIt.name);
    await page.getByLabel('Market', { exact: true }).pressSequentially(o.nameIt.market);
    await page.getByLabel('Currency', { exact: true }).selectOption(o.nameIt.currency);
    if (o.nameIt.lotSize) await page.getByLabel('Shares in a lot', { exact: true }).pressSequentially(o.nameIt.lotSize);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.getByRole('button', { name: new RegExp(`^${o.pick ?? o.search}\\b`) }).first().click();
  }
  if (typeof o.broker === 'string') await page.getByLabel('Where is it kept').selectOption({ label: o.broker });
  else {
    await page.getByLabel('Where is it kept').selectOption({ label: 'Another broker…' });
    await page.getByLabel('Broker name').pressSequentially(o.broker.new);
    if (o.broker.currency) await page.getByLabel('Its currency').selectOption(o.broker.currency);
  }
  await page.getByLabel(/^(Lots|Shares)$/).pressSequentially(o.quantity);
  await page.getByLabel(/^Price per share/).pressSequentially(o.price);
  if (o.fee) await page.getByLabel(/^Fee/).pressSequentially(o.fee);
  await page.getByLabel('Paid from').selectOption({ label: o.paidFrom });
  if (o.charged) await page.getByLabel(/^Charged in/).pressSequentially(o.charged);
}

/** BBCA from the IDX list, or — while that list is pending — named by hand with the list's own facts. */
export const bbcaFirst = (): { search: string; nameIt?: NameIt } => (idxPending ? { search: 'BBCA', nameIt: BBCA_BY_HAND } : { search: 'BBCA' });

/** The token as a computed colour — moved here from phone-dark-shell.spec.ts, which now imports it. */
export async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${property})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}
