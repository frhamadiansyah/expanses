import { expect, type Page } from '@playwright/test';

// Local time, like every date field in the app: toISOString() is UTC, so between midnight and 07:00
// in Jakarta it names yesterday and any window built from it excludes what was just recorded.
const NOW = new Date();
export const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

export async function addWallet(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

/** Spending against the Food and beverage parent, which the event can then be planned against. */
export async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Food and beverage (general)' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: description }).first()).toBeVisible();
}

export async function addEvent(page: Page, name: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  // Saving opens the event: planning it is what comes next.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export interface ItemFields {
  name: string;
  price: string;
  quantity?: string;
  category?: string;
  link?: string;
  note?: string;
}

/** Fills the item form that is already open, and saves it. */
export async function fillItem(page: Page, options: ItemFields) {
  await page.getByLabel('What', { exact: true }).fill(options.name);
  if (options.quantity) await page.getByLabel('How many').fill(options.quantity);
  await page.getByLabel('Price each').fill(options.price);
  if (options.category) await page.getByLabel('Category').selectOption({ label: options.category });
  if (options.link) await page.getByLabel('Link').fill(options.link);
  if (options.note) await page.getByLabel('Note').fill(options.note);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: options.name })).toBeVisible();
}

/** From the plan: ＋ and then the form. "Add the first item" on an empty plan opens the same form. */
export async function addItem(page: Page, options: ItemFields) {
  await page.getByRole('link', { name: 'Add an item' }).first().click();
  await fillItem(page, options);
}

/**
 * From an event: open its plan, add one thing in a category, and come back.
 *
 * The category is drawn on by planning something in it — there is no figure to set for a category any more, and a
 * category with no items is not part of the plan at all. The item takes the category's own name, which is what
 * migration 0049 made of the caps that came before it.
 */
export async function planFor(page: Page, category: string, amount: string, option = category) {
  // By test id, not by words: the card's link says "Plan what to buy" while nothing is planned and "See the whole
  // plan" once there are items, and this helper is called both before and after the first one.
  await page.getByTestId('open-plan').click();
  await addItem(page, { name: category, price: amount, category: option });
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await expect(page.getByTestId('open-plan')).toBeVisible();
}
