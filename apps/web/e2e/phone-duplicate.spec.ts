import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { todayIn } from './today';

/** The phone's New event form, as phone-events.spec.ts fills it. */
async function addEvent(page: Page, name: string) {
  const today = await todayIn(page);
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(today);
  await page.getByLabel('Ends on').fill(today);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

async function settledBox(page: Page, target: Locator) {
  let box = (await target.boundingBox())!;
  await expect(async () => {
    await page.waitForTimeout(150);
    const again = (await target.boundingBox())!;
    const still = again.x === box.x && again.y === box.y && again.height === box.height;
    box = again;
    expect(still).toBe(true);
  }).toPass({ timeout: 5_000 });
  return box;
}

/** Pointer down, a long drag to the left, up: far enough to stand three buttons open. */
async function swipeLeft(page: Page, target: Locator) {
  // The row can sit under the floating tab bar; a drag there lands on the bar.
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await settledBox(page, target);
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from - (180 * step) / 10, y);
  await page.mouse.up();
}

/**
 * One purchase with a category, a note, a day other than today and, when asked, an event: the fields a duplicate must
 * carry. An event's spending leaves Cashflow's list, so the swipe journey records it without one and the receipt
 * journey, which reaches the receipt from the event's page, records it with one.
 */
async function recordSteak(page: Page, day: string, withEvent: boolean) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '120000');
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Warung Steak');
  await form.getByLabel('Date').fill(day);
  if (withEvent) {
    await form.getByRole('button', { name: 'Add more details' }).click();
    const more = page.getByRole('region', { name: 'More details' });
    await more.getByRole('button', { name: 'Event' }).click();
    await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Lebaran' }).click();
  }
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

/** The Duplicate screen, read: titled so, every entry field carried over, the figure waiting to be typed over. */
async function expectCopied(page: Page, day: string) {
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\/duplicate$/);
  await expect(page.locator('header').getByText('Duplicate', { exact: true })).toBeVisible();
  const form = page.getByRole('form', { name: 'Duplicate a transaction' });
  await expect(form.getByRole('button', { name: /^Payment method/ })).toContainText('BCA Tahapan');
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Restaurants');
  await expect(form.getByLabel('Note')).toHaveValue('Warung Steak');
  await expect(form.getByLabel('Date')).toHaveValue(day);
  return form;
}

/** The keypad opens on the copied figure; the first digit replaces it rather than being appended. */
async function typeOver(page: Page, form: Locator, amount: string, withEvent: boolean) {
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeVisible();
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText('120.000');
  await fillAmount(page, form, amount);
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText(/^95\.000$/);
  if (!withEvent) return;
  // The event is on the copy too; the details open under the card once the dock is out of the way.
  await form.getByRole('button', { name: 'Add more details' }).click();
  await expect(page.getByRole('region', { name: 'More details' }).getByRole('button', { name: 'Event' })).toContainText('Lebaran');
}

test('a row swipes to Duplicate, which opens the Add screen on a copy and saves a second, independent row', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  const day = await todayIn(page, 3);
  await recordSteak(page, day, false);

  const steak = row(page, 'Warung Steak');
  await expect(steak).toHaveCount(1);
  await swipeLeft(page, steak);
  // Three actions, Duplicate leftmost, then Edit, then Delete.
  const xs: number[] = [];
  for (const name of ['Duplicate', 'Edit', 'Delete']) {
    const button = steak.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    xs.push((await button.boundingBox())!.x);
  }
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  await steak.getByRole('button', { name: 'Duplicate', exact: true }).click();

  const form = await expectCopied(page, day);
  await typeOver(page, form, '95000', false);
  await saveButton(form).click();

  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(row(page, 'Warung Steak')).toHaveCount(2);
  const amounts = await row(page, 'Warung Steak').getByText(/^-?Rp/).allInnerTexts();
  expect(amounts.map((text) => text.replace(/\D/g, '')).sort()).toEqual(['120000', '95000']);
  // The original is untouched, and the copy kept the category.
  await expect(row(page, 'Warung Steak').filter({ hasText: '120.000' })).toContainText('Restaurants');
  await expect(row(page, 'Warung Steak').filter({ hasText: '95.000' })).toContainText('Restaurants');
});

test('the receipt page offers Duplicate beside Edit', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await addEvent(page, 'Lebaran');
  const day = await todayIn(page, 3);
  await recordSteak(page, day, true);

  // Event spending is not in Cashflow's list: the receipt is reached from the event's own page.
  await expect(row(page, 'Warung Steak')).toHaveCount(0);
  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Lebaran' }).click();
  const eventUrl = page.url();
  const history = page.getByTestId('event-history').filter({ hasText: 'Warung Steak' });
  await history.getByRole('button').and(history.getByTitle('Open the receipt')).click();
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate this transaction' }).click();

  const form = await expectCopied(page, day);
  await typeOver(page, form, '95000', true);
  await saveButton(form).click();
  // Saved, it is back on the event the receipt was opened from.
  await expect(page).toHaveURL(eventUrl);
  // The copy kept the event, so it joined the original there rather than in Cashflow's list.
  await expect(page.getByTestId('event-history').filter({ hasText: 'Warung Steak' })).toHaveCount(2);
});
