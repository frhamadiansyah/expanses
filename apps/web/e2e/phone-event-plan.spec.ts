import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { buyItNow, expectCover, expectPlanHero, fillItem, TODAY, showPlanCard } from './event-plan';
import { addTransaction } from './add-transaction';

/*
 * The plan, by thumb.
 *
 * `event-plan.spec.ts` cannot cover any of this: the phone project matches `/phone[.-]/` by filename, so that spec
 * never runs at 390px and the plan screen, the item page, the item form, the pick-purchase list and "What it covers"
 * had no phone spec of their own at all. The five of them are the only screens of this feature, and every one of
 * them is reached here through the shell's own controls — the account sheet, the round `＋`, the wide links — rather
 * than by typing a URL.
 *
 * It proves the desktop-parity rule from the other side as well. Everything below is found by role and accessible
 * name, so a control that works here can be reached by the chromium spec too: nothing on a phone may be a gesture
 * with no name on it, and desktop is never the weaker of the two.
 */

/** Anything a finger is meant to hit must be at least this tall and wide. The same 44 as `phone.spec.ts`. */
const TAP = 44;

async function settle(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** A phone is 390px wide and nothing may reach past it — not a figure, not a row, not a card. */
async function noSideways(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

async function bigEnough(target: Locator, what: string) {
  const box = await target.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  expect(Math.min(box!.width, box!.height), `${what} is ${box!.width}×${box!.height}`).toBeGreaterThanOrEqual(TAP);
}

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('an event is planned, bought from and settled with a thumb', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });

  // Recorded before the event exists, so there is a real receipt to share out between two items later on.
  await page.goto('/cards');
  await settle(page);
  await addTransaction(page, { description: 'Mothercare', paidWith: 'BCA Tahapan', category: 'Food and beverage', amount: '4150000' });

  // The way to an event on a phone: the account sheet, where every screen the tab bar cannot hold lives.
  await page.goto('/');
  await settle(page);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('link', { name: /^Events/ }).click();
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

  // The round ＋, not the worded button: on a phone the header gives the title its room and puts the action in a ring.
  const newEvent = page.getByRole('button', { name: 'New event' });
  await bigEnough(newEvent, 'New event');
  await expect(page.getByRole('button', { name: 'Add an event' })).toHaveCount(0);
  await newEvent.click();
  await page.getByLabel('Name', { exact: true }).fill('Newborn');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Newborn', exact: true })).toBeVisible();
  await noSideways(page, 'the event');

  // By its accessible name, like everything else here: the card's link reads "Plan what to buy" while nothing is
  // planned and "See the whole plan" once there are items, and this spec's whole claim is that nothing on a phone
  // is reached by anything a desktop cannot reach by name.
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await expect(page.getByText('Nothing planned yet')).toBeVisible();
  await noSideways(page, 'an empty plan');

  /*
   * The plan's own ＋. Both the round control and the worded button carry the name "Add an item" — that is the
   * parity rule at work, one name for one action — and at this width only the round one is on screen.
   */
  const plus = page.getByRole('link', { name: 'Add an item' });
  await expect(plus).toHaveCount(1);
  await bigEnough(plus, 'the plan’s ＋');
  await bigEnough(page.getByRole('link', { name: 'Add the first item' }), 'Add the first item');
  await plus.click();

  await expect(page.getByRole('heading', { name: 'New item' })).toBeVisible();
  await noSideways(page, 'the item form');
  // Four of a thing, priced one at a time: the estimate is how many × price each and has no field to disagree with.
  await page.getByLabel('What', { exact: true }).fill('Muslin wraps');
  await page.getByLabel('How many').fill('4');
  await page.getByLabel('Price each').fill('175000');
  await page.getByLabel('Category').selectOption({ label: 'Food and beverage' });
  await expect(page.getByLabel('Estimate')).toHaveValue(/700\.000/);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Muslin wraps' })).toContainText('4 × Rp 175.000');

  for (const item of [
    { name: 'Crib', price: '7500000' },
    { name: 'Newborn clothes', quantity: '10', price: '150000' },
  ]) {
    await page.getByRole('link', { name: 'Add an item' }).first().click();
    await fillItem(page, { ...item, category: 'Food and beverage' });
  }
  await noSideways(page, 'a plan with items');

  /*
   * The receipt joins the trip through the event's own suggestions, which is why it is tagged here and not
   * earlier: an event offers a payment because it is in a category the plan names, so before the first item
   * there is nothing for it to recognise.
   */
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Mothercare' }).click();
  await expect(page.getByTestId('event-total')).toContainText('4.150.000');
  await noSideways(page, 'an event with a plan');
  await showPlanCard(page);
  await page.getByRole('link', { name: 'See the whole plan' }).click();

  // Buying: the item's page, then the Add screen filled in from the estimate, with the real price typed over it.
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await bigEnough(page.getByRole('link', { name: 'Edit' }), 'the item’s Edit');
  await noSideways(page, 'an item');
  await buyItNow(page, { paid: '7200000' });

  // Ticked, at what it really cost, with the difference beside it.
  const crib = page.getByTestId('plan-item').filter({ hasText: 'Crib' });
  await expect(page.getByRole('button', { name: 'Unlink Crib' })).toBeVisible();
  // The tick undoes a purchase, so it is a control like any other: it was the one thing on these screens drawn at
  // the dot's own 24px, under the 44 the ＋, the wide links and the way back are all held to above.
  await bigEnough(page.getByRole('button', { name: 'Unlink Crib' }), 'the plan’s tick');
  await expect(crib).toContainText('7.200.000');
  await expect(crib).toContainText('−Rp 300.000');

  // One receipt over two items, every share typed together and checked against the one payment.
  await page.getByTestId('plan-item').filter({ hasText: 'Newborn clothes' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a purchase' }).click();
  await noSideways(page, 'the list of payments');
  await page.getByRole('link', { name: /Mothercare/ }).click();
  await expect(page.getByRole('heading', { name: 'What it covers' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Muslin wraps' }).check();
  await expectCover(page, {
    Receipt: 'Rp 4.150.000',
    'Given to items': 'Rp 2.200.000',
    'Left on this receipt not planned': 'Rp 1.950.000',
  });
  await noSideways(page, 'what it covers');
  await page.getByRole('button', { name: 'Save' }).click();

  /*
   * Every figure of the finished plan, by hand: 700.000 + 7.500.000 + 1.500.000 planned; 7.200.000 for the crib and
   * 2.200.000 of the Mothercare receipt bought; nothing left to buy; and the crib's 300.000 under the difference.
   */
  await expectPlanHero(page, { count: '3 of 3 bought', toGo: 'All bought', planned: 'Planned Rp 9.700.000 · Bought Rp 9.400.000 · −Rp 300.000' });
  await noSideways(page, 'a settled plan');

  // And the way back out is a thumb's reach too, on the screen it came from.
  await bigEnough(page.getByRole('link', { name: 'Back to the event' }), 'Back to the event');
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await expect(page.getByRole('heading', { name: 'Newborn', exact: true })).toBeVisible();
});

