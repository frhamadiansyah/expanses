import { expect, type Page } from '@playwright/test';
import { fillDay } from './add-asset';
import { setCurrency } from './currency-field';

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
    /** Ignored: a purchase from before the app is added without its fee. */
    fee?: string;
    /** Ignored: Add a holding is past-only (Opening Balances). Kept so callers read as they did. */
    paidFrom?: string;
    charged?: string;
    /** The day it was bought, when it was not today. */
    date?: string;
    /** The day's rate, for a foreign buy the device holds no rate for. */
    rate?: string;
  },
) {
  await page.goto('/net-worth/investments/new');
  // The form opens first; its Ticker row opens the search.
  await page.getByRole('button', { name: /^Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially(o.search);
  if (o.nameIt) {
    await page.getByRole('button', { name: /Name it myself/ }).click();
    await page.getByLabel('Ticker', { exact: true }).pressSequentially(o.nameIt.ticker);
    await page.getByLabel('Name', { exact: true }).pressSequentially(o.nameIt.name);
    await page.getByLabel('Market', { exact: true }).pressSequentially(o.nameIt.market);
    await setCurrency(page.getByLabel('Currency', { exact: true }), o.nameIt.currency);
    if (o.nameIt.lotSize) await page.getByLabel('Shares in a lot', { exact: true }).pressSequentially(o.nameIt.lotSize);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.getByRole('button', { name: new RegExp(`^${o.pick ?? o.search}\\b`) }).first().click();
  }
  if (typeof o.broker === 'string') await page.getByLabel('Broker', { exact: true }).selectOption({ label: o.broker });
  else {
    await page.getByLabel('Broker', { exact: true }).selectOption({ label: 'Another broker…' });
    await page.getByLabel('Broker name').pressSequentially(o.broker.new);
    if (o.broker.currency) await page.getByLabel('Its currency').selectOption(o.broker.currency);
  }
  await page.getByLabel(/^(Lots|Shares)$/).pressSequentially(o.quantity);
  await page.getByLabel(/^Price per share/).pressSequentially(o.price);
  // Add a holding is past-only: what was bought before the app, on a day picked as Add asset's Bought is.
  await fillDay(page, 'Bought', o.date ?? new Date().toISOString().slice(0, 10));
  if (o.rate) {
    // A day the device holds no rate for is only asked once the form has looked: the first save says what is
    // missing and turns the read-only line into a field. The caller's own "Add holding" then saves it.
    await page.getByRole('button', { name: 'Add holding' }).click();
    await expect(page.getByRole('alert')).toContainText('Rate that day');
    await page.getByLabel('Rate that day').pressSequentially(o.rate);
  }
}

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
