import { expect, type Locator, type Page } from '@playwright/test';
import { TODAY } from './event-plan';
import { choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';

/*
 * Helpers for the shared-events journey. Everything that names the shared Add screen (Task 13) is here and nowhere
 * else, so when that screen's words settle a spec never needs touching: the screen is built from the normal Add
 * screen's pieces, so its amount is the keypad's (never a typed field), its rows are `FormRow`s and its pickers are
 * sheets.
 */

/** The app comes back to the foreground: every shared book syncs (household sharing §9.4). */
export async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await check();
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });
}

/** A corner action by name, inline or under ⋯. */
export async function corner(page: Page, name: string) {
  const inline = page.getByRole('button', { name, exact: true });
  if ((await inline.count()) > 0) return inline.first().click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
}

export async function openTrip(page: Page, name = 'Coast week') {
  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: name }).click();
  await expect(page.getByTestId('shared-event')).toBeVisible({ timeout: 30_000 });
}

/** An event for today, from either shell: the phone's button says "New event", the desktop's "Add an event". */
export async function newEvent(page: Page, name: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: /^(New event|Add an event)$/ }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** A row of the trip's Spending list, by its note. */
export const spendingRow = (page: Page, text: string) => page.getByTestId('shared-expense-row').filter({ hasText: text });

/** The Balances section of the trip page (a radio of the segmented control). */
export async function showBalances(page: Page) {
  await page.getByRole('radio', { name: 'Balances' }).click();
}

/** The shared Add screen, whichever way it is drawn. */
export const sharedCard = (page: Page): Locator => page.getByTestId('shared-expense-card');

export interface SharedSpend {
  note: string;
  /** Digits only: the keypad types digits. */
  amount: string;
  /** The currency the amount is typed in, by code, when it is not the event's. */
  currency?: string;
  /** The account (or card) this phone's person paid with, by name. */
  paidWith: string;
  /** What the paying account was charged, in its own currency, typed on the keypad when it is not the amount's. */
  charged?: { currency: string; amount: string };
  /** People left out of an equal split, by name. */
  leaveOut?: string[];
}

/**
 * Fills the open shared Add screen and saves it, in the card's own order: Paid with (Paid by is this phone's person by
 * default), the amount on the keypad (the owner's rule: no typed amount field on the Add screen), its currency, Note,
 * the Split, then the bar's ✓.
 */
export async function recordSharedSpend(page: Page, spend: SharedSpend) {
  const card = sharedCard(page);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, spend.paidWith, 'Paid with');
  if (spend.currency) {
    await card.getByRole('button', { name: 'Currency' }).click();
    await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${spend.currency}\\b`) }).first().click();
  }
  await openAmount(card);
  await fillAmount(page, card, spend.amount);
  if (spend.charged) {
    await card.getByRole('button', { name: `Charged in ${spend.charged.currency}` }).click();
    await fillAmount(page, card, spend.charged.amount);
  }
  await card.getByLabel('Note', { exact: true }).fill(spend.note);
  if (spend.leaveOut?.length) {
    await card.getByRole('button', { name: /^Split/ }).click();
    const split = page.getByRole('dialog', { name: 'Split' });
    for (const name of spend.leaveOut) await split.getByRole('button', { name: `${name} shares it` }).click();
    await page.keyboard.press('Escape');
  }
  await saveButton(card).click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });
}
