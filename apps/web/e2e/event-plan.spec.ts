import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { addEvent, addItem, addWallet, expectCover, expectFigures, expectGauge, expectKitFigures, fillItem, moneyIn, spend } from './event-plan';
import { replaceTheDatabase } from './recovery-fixture';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Records spending straight into the open event, which is the only form in the app that can tag as it posts. */
async function recordInto(page: Page, description: string, amount: string, category = 'Food and beverage') {
  await page.getByRole('button', { name: 'Add spending' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('');
  await page.getByRole('button', { name: 'Done' }).click();
}

/**
 * The ledger as the database actually holds it, taken out through the door a user has: Download backup.
 *
 * Nothing on the plan screens may write an entry. That is the constraint the whole feature stands on — a share is a
 * *reading* of a purchase and never a split of one, so the statement, the points, the card cycle and the tax report
 * must read afterwards exactly as they did before — and no screen can show it, because a screen showing the same
 * total either way is exactly what a split would look like from the outside. So it is read off the file.
 */
async function ledgerOf(page: Page): Promise<{ entries: unknown[]; postings: unknown[]; claimed: number }> {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = await (await downloaded).path();
  const db = new BetterSqlite3(file!, { readonly: true });
  try {
    return {
      entries: db.prepare('SELECT * FROM entries ORDER BY id').all(),
      // The transactions themselves too: an entry left alone on a payment that was voided or re-dated is no comfort.
      postings: db.prepare('SELECT id, occurred_on, description, status, event_id FROM transactions ORDER BY id').all(),
      // What the save is *supposed* to change, so a test that watched nothing happen cannot pass by watching it.
      claimed: (db.prepare('SELECT count(*) AS n FROM event_items WHERE transaction_id IS NOT NULL').get() as { n: number }).n,
    };
  } finally {
    db.close();
  }
}

test('a plan is a list of things to buy, and a category is only their sum', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await expect(page.getByText('Nothing planned yet')).toBeVisible();

  await page.getByRole('link', { name: 'Add the first item' }).click();
  // 'Food and beverage' is the label the other event specs already prove is in the default tree; the point here is
  // the arithmetic, not which category the pram lands in.
  await fillItem(page, { name: 'Stroller Bugaboo', price: '12000000', category: 'Food and beverage', link: 'tokopedia.com/bugaboo', note: 'Second-hand ok' });
  await addItem(page, { name: 'Check-ups', quantity: '6', price: '500000', category: 'Food and beverage' });

  // Six at Rp500.000 is Rp3.000.000, and the arithmetic is shown on the row.
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Check-ups' })).toContainText('6 × Rp 500.000');
  await expect(page.getByTestId('plan-totals')).toContainText('15.000.000');
  await expect(page.getByTestId('plan-totals')).toContainText('Still to buy');
  // Nowhere on the plan is there a figure to set for a category.
  await expect(page.getByLabel('Planned', { exact: true })).toHaveCount(0);
});

/**
 * What the form shows is what the form saves.
 *
 * "How many" used to fall back to 1 on anything that was not a whole number, so a `0` or a `2.5` showed an Estimate of
 * Rp 0 and then wrote one of the thing at the full price — the user shown one figure and given another, with no error
 * anywhere. It also put the repository's own `QUANTITY_RANGE` out of reach of the only form that can produce it.
 */
test('a quantity that is not a whole number is refused, and so is a price of nothing', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await page.getByLabel('What', { exact: true }).fill('Bottles');
  await page.getByLabel('Price each').fill('500000');

  for (const typed of ['0', '2.5', 'abc']) {
    await page.getByLabel('How many').fill(typed);
    // Nothing of it parses, so the estimate is nought — and nought is what the save is asked for.
    await expect(page.getByLabel('Estimate')).toHaveValue(/Rp\s*0$/);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('How many must be a whole number above nought');
    // Still on the form, and nothing was written: 1 × Rp 500.000 never happened.
    await expect(page.getByLabel('How many')).toHaveValue(typed);
  }

  /*
   * And a price of nothing is refused the same way, by the same door.
   *
   * An event "has a plan" when something is on the list, whatever it adds up to — so a list of free things would be
   * a plan whose ring is all nought and whose every item is exactly on estimate for ever. The repository refuses it
   * (`PRICE_RANGE`), and this is the only form that can reach that refusal, so it is held here.
   */
  await page.getByLabel('How many').fill('1');
  await page.getByLabel('Price each').fill('0');
  await expect(page.getByLabel('Estimate')).toHaveValue(/Rp\s*0$/);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('A price each is a figure above nought');
  await page.getByLabel('Price each').fill('500000');

  // A whole number above nought saves, at the estimate the form showed all along.
  await page.getByLabel('How many').fill('6');
  await expect(page.getByLabel('Estimate')).toHaveValue(/3\.000\.000/);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Bottles' })).toContainText('6 × Rp 500.000');
  await expect(page.getByTestId('plan-totals')).toContainText('3.000.000');
});

/**
 * The item list is the whole answer to a figure that moved: editing changes the row that is there, and adding makes
 * a row of its own. The card this screen replaced had neither — it took a category and a total and appended, so
 * naming a category twice doubled its planned figure with nothing on screen to show why.
 */
test('an edit changes the item it opened, and never quietly makes a second one', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Muslin wraps', quantity: '4', price: '175000', category: 'Food and beverage' });
  await expect(page.getByTestId('plan-totals')).toContainText('700.000');

  await page.getByTestId('plan-item').filter({ hasText: 'Muslin wraps' }).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Muslin wraps' })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  // The estimate is shown, never typed: it is how many × price each and has no field of its own to disagree with.
  await expect(page.getByLabel('Estimate')).toHaveValue(/700\.000/);
  await page.getByLabel('How many').fill('6');
  await expect(page.getByLabel('Estimate')).toHaveValue(/1\.050\.000/);
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Back to the plan' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Muslin wraps' })).toHaveCount(1);
  await expect(page.getByTestId('plan-totals')).toContainText('1.050.000');
});

/** Spending that was already tagged is not lost by planning: it reads as "not planned" beside the items. */
test('what was tagged before the plan sits under its category as not planned', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');
  await addEvent(page, 'Lebaran');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await expect(page.getByText('Nothing planned yet')).toBeVisible();

  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Hampers for the office', price: '3000000', category: 'Food and beverage' });
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Hampers' }).click();
  await expect(page.getByTestId('event-sheet')).toContainText('4.200.000');

  // One item is planned by now, so the card's link has changed from an invitation into a way back in.
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  // Label to figure, not two substring assertions that never meet: `toContainText('Not planned')` beside
  // `toContainText('4.200.000')` passes on a card holding both words anywhere, the figure belonging to any row.
  await expectKitFigures(page.getByTestId('plan-not-planned'), { 'Not planned': 'Rp 4.200.000' });
  // The receipt's own row, in the group headed "Not planned" under its category — not the summary's figure.
  await expect(page.getByTestId('plan-unplanned').filter({ hasText: 'Hampers' })).toBeVisible();
});

/**
 * Buying, and what one receipt covers.
 *
 * "Buy it now" is the ordinary case — one receipt, one thing — and it fills the payment in from the item so only the
 * real price has to be typed. A shopping trip that answered three items cannot be ticked off three times, because the
 * first tick claims what is left of the receipt; it is settled on "What it covers", where the shares are typed
 * together and checked against the one payment. Nothing here splits the transaction: the shares are a reading of it.
 */
test('an item is bought at the real price, and one receipt can answer three', async ({ page }) => {
  await addWallet(page);
  // Recorded before the event exists, so it is there to be tagged and then shared out.
  await spend(page, 'Mothercare', '4150000');
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '7500000', category: 'Food and beverage' });
  await addItem(page, { name: 'Newborn clothes', quantity: '10', price: '150000', category: 'Food and beverage' });
  await addItem(page, { name: 'Muslin wraps', quantity: '4', price: '175000', category: 'Food and beverage' });

  // Buy it now: pre-filled from the item, and only the real price changes.
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('7500000');
  await page.getByLabel('Amount', { exact: true }).fill('7200000');
  await page.getByRole('button', { name: 'Save' }).click();
  const crib = page.getByTestId('plan-item').filter({ hasText: 'Crib' });
  await expect(crib).toContainText('7.200.000');
  await expect(crib).toContainText('−Rp 300.000');

  // One receipt over two items, with what is left reading as not planned.
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Mothercare' }).click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Newborn clothes' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a purchase' }).click();
  await page.getByRole('link', { name: /Mothercare/ }).click();
  await page.getByRole('checkbox', { name: 'Muslin wraps' }).check();
  await expect(page.getByTestId('cover-totals')).toContainText('2.200.000'); // given to items
  await expect(page.getByTestId('cover-totals')).toContainText('1.950.000'); // left on this receipt
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByTestId('plan-totals')).toContainText('Still to buy');
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Muslin wraps' })).toContainText('exactly');
  // The leftover is spending in its category, marked as part of a receipt that did answer something.
  await expect(page.getByText('part of this receipt')).toBeVisible();

  // Unticking one leaves the other, and hands its share back to the receipt.
  await page.getByRole('button', { name: 'Unlink Muslin wraps' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Newborn clothes' })).toContainText('1.500.000');
});

/**
 * A receipt already spoken for is carried to the screen that can settle it, rather than told about in a sentence.
 *
 * Ticking an item off claims what is *left* of its receipt, so the second tick against a shared one finds nothing
 * there. That is the normal path for a shopping trip, not an error: the app cannot know a receipt is shared until it
 * is told, and "What it covers" is where it is told.
 */
test('a receipt that is already spoken for is shown as fully accounted for, not offered again', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '7500000', category: 'Food and beverage' });
  await addItem(page, { name: 'Muslin wraps', quantity: '4', price: '175000', category: 'Food and beverage' });

  // The crib's own receipt takes the whole of itself, which is what one tick means.
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  // So the other item is not offered it: the row is there, said plainly, and is not a link to click.
  await page.getByTestId('plan-item').filter({ hasText: 'Muslin wraps' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a purchase' }).click();
  await expect(page.getByText('fully accounted for')).toBeVisible();
  await expect(page.getByRole('link', { name: /Crib/ })).toHaveCount(0);

  // And the crib's own page carries the same receipt to the screen where it can be split between items.
  await page.getByRole('link', { name: 'Back to the item' }).click();
  await page.getByRole('link', { name: 'Back to the plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Say what it covers' }).click();
  await expect(page.getByRole('heading', { name: 'What it covers' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Muslin wraps' }).check();
  await expect(page.getByTestId('cover-totals')).toContainText('that is more than the receipt');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

/**
 * The two readings a plan owes outside its own screen.
 *
 * On the list an event says what is still to buy, and its figure is read against the plan rather than against
 * nothing. In the history each payment says what it answered: the items it settled, and — when there is still
 * something left on the receipt — that the remainder was not planned. A receipt can honestly say both.
 */
test('the list says what is still to buy, and the history says what each payment answered', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Mothercare', '4150000');
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Newborn clothes', quantity: '10', price: '150000', category: 'Food and beverage' });
  await addItem(page, { name: 'Car seat', price: '6500000', category: 'Food and beverage' });
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Mothercare' }).click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Newborn clothes' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a purchase' }).click();
  await page.getByRole('link', { name: /Mothercare/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Back to the event' }).click();
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  const mothercare = page.getByTestId('event-history').filter({ hasText: 'Mothercare' });
  // It answered one item and left Rp2.650.000 on the receipt, so it says both.
  await expect(mothercare).toContainText('Newborn clothes');
  await expect(mothercare).toContainText('not planned');

  await page.getByRole('link', { name: 'All events' }).click();
  // The line says what is left to buy, and the figure is read against the plan rather than against nothing.
  await expect(page.getByTestId('event-row')).toContainText('6.500.000 still to buy');
  await expect(page.getByTestId('event-row')).toContainText('8.000.000');
});

/**
 * Every figure of one event, in one test, read as label → figure so no two of them can be confused.
 *
 * The plan's summary has four figures and the event's ring another six, and two of them are genuinely the same
 * amount here — Rp7.200.000 is both what was bought and what is still to buy — so a pair of `toContainText`
 * assertions would pass twice over one figure and never notice the other was missing. Read as pairs, each figure
 * is pinned to the words printed above it, and a label swapped with its neighbour fails.
 *
 * Worked by hand from what is typed below:
 *   Planned          7.500.000 + 6.500.000 + 4 × 175.000        = 14.700.000
 *   Bought so far    the crib's receipt                          =  7.200.000
 *   Still to buy     6.500.000 + 700.000                         =  7.200.000
 *   Difference       7.200.000 paid against 7.500.000 planned    =   −300.000
 *   Spent on plan    7.200.000 + the 900.000 steriliser          =  8.100.000
 *   Not planned      the steriliser, which answers no item       =    900.000
 */
test('the figures agree with each other', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Bottle steriliser', '900000');
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '7500000', category: 'Food and beverage' });
  await addItem(page, { name: 'Car seat', price: '6500000', category: 'Food and beverage' });
  await addItem(page, { name: 'Muslin wraps', quantity: '4', price: '175000', category: 'Food and beverage' });
  /*
   * Read once before anything is bought as well as after, because after the buy "Bought so far" and "Still to buy"
   * are both Rp7.200.000 — and a pair of figures that are equal cannot tell which label belongs to which. Here they
   * are Rp0 and the whole plan, so the two are pinned to their own words and a swap of the two fails.
   */
  await expectKitFigures(page.getByTestId('plan-totals'), {
    Planned: 'Rp 14.700.000',
    'Bought so far': 'Rp 0',
    'Still to buy': 'Rp 14.700.000',
  });

  await page.getByRole('link', { name: 'Back to the event' }).click();
  // Tagged, and nothing on the plan claims it: Rp900.000 of spending nobody planned.
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Bottle steriliser' }).click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('7200000');
  await page.getByRole('button', { name: 'Save' }).click();

  const totals = page.getByTestId('plan-totals');
  await expectKitFigures(totals, {
    Planned: 'Rp 14.700.000',
    'Bought so far': 'Rp 7.200.000',
    'Still to buy': 'Rp 7.200.000',
    'Difference so far': '−Rp 300.000',
  });
  // Outside the grid, under a rule of its own: money spent on the event that no item on the plan claims — and
  // read as label → figure like every other, rather than as a sweep of the card for that number somewhere in it.
  await expectKitFigures(page.getByTestId('plan-not-planned'), { 'Not planned': 'Rp 900.000' });

  await page.getByRole('link', { name: 'Back to the event' }).click();
  const sheet = page.getByTestId('event-sheet');
  /*
   * Where it went is the page that shows every category, and the only place left that reads one category's
   * spending against one category's plan — "Against the plan" has no rows at all now, because a bar drawn over a
   * category nobody planned would be measuring spending against a figure nobody set.
   */
  await expect(page.getByTestId('event-detail-sheet')).toContainText(/Rp\s?8\.100\.000\s*of\s*Rp\s?14\.700\.000/);

  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  await expect(page.getByTestId('event-detail-sheet')).toHaveCount(0);
  // The plan's own words on the arc — a card handed the Budget page's would say "Budgeted" with every figure right.
  await expectGauge(sheet, { Planned: 'Rp 14.700.000', Spent: 'Rp 8.100.000', 'Still to buy': 'Rp 7.200.000' });
  await expect(sheet.getByRole('img', { name: /left of the plan/i })).toBeVisible();
  await expectFigures(sheet, { 'Difference so far': '−Rp 300.000', 'Not planned': 'Rp 900.000' });
});

/**
 * The constraint the whole branch turns on: a share is a reading of a purchase, never a split of one.
 *
 * Nothing on screen can prove it — a page showing Rp4.150.000 at Mothercare looks the same whether the receipt was
 * left alone or quietly cut into two entries that happen to add back to it. So the ledger itself is read out of the
 * database on either side of a Save that gives one receipt to two items, and every row of `entries` must come back
 * byte for byte identical, with the transactions themselves unmoved. The count of items holding a purchase is read
 * too, so this cannot pass by having watched a Save that did nothing at all.
 */
test('one receipt answers two items and not one entry of the ledger moves', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Mothercare', '4150000');
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Newborn clothes', quantity: '10', price: '150000', category: 'Food and beverage' });
  await addItem(page, { name: 'Muslin wraps', quantity: '4', price: '175000', category: 'Food and beverage' });
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Mothercare' }).click();
  await expect(page.getByTestId('event-total')).toContainText('4.150.000');

  const before = await ledgerOf(page);
  expect(before.claimed).toBe(0);
  expect(before.entries.length).toBeGreaterThan(0);

  await page.goto('/events');
  await page.getByTestId('event-row').click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Newborn clothes' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a purchase' }).click();
  await page.getByRole('link', { name: /Mothercare/ }).click();
  await page.getByRole('checkbox', { name: 'Muslin wraps' }).check();
  // Three lines of one card, each figure pinned to its own label: 1.500.000 + 700.000 given, 1.950.000 left.
  await expectCover(page, {
    Receipt: 'Rp 4.150.000',
    'Given to items': 'Rp 2.200.000',
    'Left on this receipt not planned': 'Rp 1.950.000',
  });
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByTestId('plan-item').filter({ hasText: 'Muslin wraps' })).toContainText('exactly');
  await expect(page.getByText('part of this receipt')).toBeVisible();

  const after = await ledgerOf(page);
  // Two items now hold a share of that one receipt — so something certainly happened.
  expect(after.claimed).toBe(2);
  // And the ledger is exactly what it was: same entries, same amounts, same transactions, in the same order.
  expect(after.entries).toEqual(before.entries);
  expect(after.postings).toEqual(before.postings);
});

/**
 * Money that came back, beside money nobody planned — the arrangement in which the two cannot be the same figure.
 *
 * With a refund as an event's *only* unplanned money, "what came back" and "what the clamp swallowed" are the same
 * number and a screen can print either. Here Rp5.000.000 of hampers is unplanned as well, so they part company: the
 * headings must read 5.000.000 and 1.000.000, each equal to the rows printed beneath it, rather than 4.000.000 over
 * rows adding to 5.000.000 with the refund named nowhere at all.
 */
test('money back is named with the rows it adds up, beside spending nobody planned', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '3000000', category: 'Food and beverage' });
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Back to the event' }).click();
  await recordInto(page, 'Hampers', '5000000');
  // Two of them, so the heading is the sum of its rows rather than a copy of the only one there is.
  await recordInto(page, 'Toko Bayi refund', '-600000');
  await recordInto(page, 'Ongkir refund', '-400000');

  await page.getByRole('link', { name: 'See the whole plan' }).click();
  const totals = page.getByTestId('plan-totals');
  // "Planned so far", not "Planned": a refund answers no item, so the plan is not the whole account of the money.
  await expectKitFigures(totals, {
    'Planned so far': 'Rp 3.000.000',
    'Bought so far': 'Rp 3.000.000',
    'Still to buy': 'Rp 0',
    'Difference so far': 'exactly',
  });

  const back = page.getByTestId('plan-money-back');
  await expect(back).toContainText('Money back');
  const [heading, ...rows] = await moneyIn(back);
  expect(rows).toEqual([400_000, 600_000]); // newest first, as the rows are sorted
  expect(heading).toBe(rows.reduce((total, row) => total + row, 0));

  // And "Not planned" is the hampers alone — never the hampers with a refund netted off them.
  await expectKitFigures(page.getByTestId('plan-not-planned'), { 'Not planned': 'Rp 5.000.000' });
  await expect(page.getByText('Hampers')).toBeVisible();

  await page.getByRole('link', { name: 'Back to the event' }).click();
  const sheet = page.getByTestId('event-sheet');
  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  await expectFigures(sheet, { 'Difference so far': 'exactly', 'Not planned': 'Rp 5.000.000', 'Money back': 'Rp 1.000.000' });
});

/**
 * An event that got more back than it ever spent, which is where both halves of the rule broke at once.
 *
 * Reachable whenever a refund is tagged to an event whose original purchase never was. Spending then sits below
 * nought, and this page used to give one quantity three answers: the chart drew −Rp1.000.000, the row under the ring
 * built to quote that chart drew a clamped Rp0, and the ring's own middle drew the negative again beside a Plan card
 * drawing nought. A negative on screen and a clamp nothing explained, on the page whose whole job is to reconcile
 * the two totals.
 *
 * So: nothing below nought anywhere, no nought passed off as a total, and what actually happened said in the words
 * this page already keeps for money coming back. The refund lands in the category the plan names, so the ring goes
 * under with the chart and all three figures are read in one arrangement.
 */
test('an event whose refunds outran it says what came back, and shows no negative and no bare nought', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '5000000', category: 'Food and beverage' });
  await page.getByRole('link', { name: 'Back to the event' }).click();

  // Nothing is ticked off: the refund answers no item, and 3.000.000 back against 2.000.000 out is 1.000.000 more
  // than the event ever spent.
  await recordInto(page, 'Hampers', '2000000');
  await recordInto(page, 'Toko Bayi refund', '-3000000');

  const sheet = page.getByTestId('event-sheet');
  const chart = page.getByTestId('event-total');
  // The chart: nought, and never −Rp1.000.000 — with what came back written under the figure it accounts for, so
  // the nought is not a number the page leaves the user to explain to themselves.
  await expect(chart.getByRole('img')).toHaveAttribute('aria-label', /^Rp\s?0 Total spent$/);
  await expect(chart).toContainText('Rp 1.000.000 more came back than went out');
  await expect(sheet).not.toContainText(/[-−]Rp/);

  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  // The ring: Rp0, the very figure the Plan card prints for the very same quantity.
  await expectGauge(sheet, { 'Planned so far': 'Rp 5.000.000', Spent: 'Rp 0', 'Still to buy': 'Rp 5.000.000' });
  await expect(page.getByTestId('event-plan-card')).toContainText(/Rp\s?0 of Rp\s?5\.000\.000/);
  /*
   * And under the ring, read as label → figure, so a row that is gone is a key that is missing: there is no
   * "Total spent" at all. Quoting the chart as Rp0 was the chart being misquoted; what came back is quoted instead.
   */
  await expectFigures(sheet, { 'Not planned': 'Rp 2.000.000', 'Money back': 'Rp 3.000.000', 'More came back than went out': 'Rp 1.000.000' });
  await expect(sheet).not.toContainText(/[-−]Rp/);
});

/**
 * Taking it back, from either screen — and taking the item away altogether.
 *
 * The tick on the plan and "Remove the link" on the item are the same undoing reached two ways, and neither may
 * touch the payment: it stays on the event and simply stops answering anything, which is what "not planned" beside
 * it means. Removing the item itself says the same thing about a thing that is no longer planned at all.
 */
test('a purchase can be unticked from either screen, and the item itself removed', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '7500000', category: 'Food and beverage' });
  await addItem(page, { name: 'Car seat', price: '6500000', category: 'Food and beverage' });

  for (const [name, paid] of [['Crib', '7200000'], ['Car seat', '6500000']] as const) {
    await page.getByTestId('plan-item').filter({ hasText: name }).getByRole('link').click();
    await page.getByRole('button', { name: 'Buy it now' }).click();
    await page.getByLabel('Amount', { exact: true }).fill(paid);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: `Unlink ${name}` })).toBeVisible();
  }
  await expectKitFigures(page.getByTestId('plan-totals'), {
    Planned: 'Rp 14.000.000',
    'Bought so far': 'Rp 13.700.000',
    'Still to buy': 'Rp 0',
    'Difference so far': '−Rp 300.000',
  });

  // What bought it, on the item's own page: the payment, the day, and the two ways out.
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  const bought = page.locator('section', { has: page.getByRole('heading', { name: 'What bought it' }) });
  await expect(bought).toContainText('Crib');
  expect(await moneyIn(bought)).toEqual([7_200_000]);
  await expect(bought.getByRole('link', { name: 'Say what it covers' })).toBeVisible();
  await bought.getByRole('button', { name: 'Remove the link' }).click();
  // The link is gone and the purchase is not: the card turns back into the one that offers to buy it.
  await expect(page.getByRole('heading', { name: 'Already bought it?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What bought it' })).toHaveCount(0);

  // The same undoing from the plan, through the tick beside the row.
  await page.getByRole('link', { name: 'Back to the plan' }).click();
  await page.getByRole('button', { name: 'Unlink Car seat' }).click();
  await expect(page.getByRole('button', { name: 'Unlink Car seat' })).toHaveCount(0);
  await expectKitFigures(page.getByTestId('plan-totals'), {
    Planned: 'Rp 14.000.000',
    'Bought so far': 'Rp 0',
    'Still to buy': 'Rp 14.000.000',
  });
  // Both payments are still on the event, answering nothing: two rows in the group headed "Not planned".
  await expect(page.getByTestId('plan-unplanned')).toHaveCount(2);

  // And removing an item leaves its purchase exactly where it is.
  await page.getByTestId('plan-item').filter({ hasText: 'Car seat' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Remove this item' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Car seat' })).toHaveCount(0);
  await expectKitFigures(page.getByTestId('plan-totals'), {
    Planned: 'Rp 7.500.000',
    'Bought so far': 'Rp 0',
    'Still to buy': 'Rp 7.500.000',
  });
  await expect(page.getByTestId('plan-unplanned')).toHaveCount(2);
});

/**
 * A refusal that leaves nothing behind.
 *
 * "Buy it now" posts the payment, tags it to the event, and only then asks the item to claim it — and a share is a
 * whole figure above nought, so buying a thing for less than nothing was refused by the repository *after* two writes
 * had already happened. The user was shown the repository's words about shares, and left holding a payment tagged to
 * their trip that they never asked for and were never offered a way to undo. So the figure is asked about first, and
 * the ledger is read on both sides of the refusal to prove that nothing was written at all.
 *
 * The amount is **negative**, and that is the whole point of the fixture. At nought the ledger was never at risk:
 * `planPosting` refuses a zero line (`ZERO_AMOUNT`) before anything is inserted, so the three ledger assertions
 * below could not fail with the guard or without it, and a guard narrowed to `amountMinor === 0` sailed through
 * them. Below nought the line is a perfectly good posting and the refusal comes from the *share*, two writes later
 * — so here, and only here, does reading the ledger on both sides mean anything. The zero case is checked after,
 * for its words; it is the negative case that holds the ledger.
 */
test('buying something for nothing is refused before a rupiah is written', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Crib', price: '7500000', category: 'Food and beverage' });

  const before = await ledgerOf(page);
  expect(before.entries.length).toBeGreaterThan(0);

  await page.goto('/events');
  await page.getByTestId('event-row').click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('-5000');
  await page.getByRole('button', { name: 'Save' }).click();
  // The screen's own words, not the repository's: `SHARE_RANGE` also says "above nought", so a refusal arriving
  // two writes too late would read almost the same. This sentence is only ever said before anything is posted.
  await expect(page.getByRole('alert')).toContainText('What it cost is a figure above nought');

  // Nothing posted, nothing tagged, nothing claimed: the ledger is byte for byte what it was.
  const after = await ledgerOf(page);
  expect(after.entries).toEqual(before.entries);
  expect(after.postings).toEqual(before.postings);
  expect(after.claimed).toBe(0);

  // And nought is refused by the same sentence rather than by the ledger's, which would name lines and not money.
  await page.goto('/events');
  await page.getByTestId('event-row').click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Crib' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('What it cost is a figure above nought');
});

/**
 * A copy of the data from before a plan was a list of things to buy.
 *
 * `event_items` arrived in migration 0049. Every write against a database without it is a deliberate no-op that
 * still hands back an id — right for the repository, and a trap for a screen, which would show an item save and
 * then vanish with nothing said. So the plan says so plainly and the form refuses to open, and that is what is
 * checked here against a real database with the table genuinely missing: taken out of the running app, emptied of
 * the table, and paged back into OPFS the way the from-the-future test does it. The migration's own row is left
 * recorded, so the app does not simply build the table again on the way in.
 */
test('data from before the plan says so, instead of losing what is typed into it', async ({ page }, testInfo) => {
  await addWallet(page);
  await addEvent(page, 'Newborn');

  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const source = await (await downloaded).path();
  // The test's own output directory is only created when something is attached to it; this is first.
  mkdirSync(testInfo.outputDir, { recursive: true });
  const older = join(testInfo.outputDir, 'before-the-plan.sqlite3');
  writeFileSync(older, readFileSync(source!));
  const db = new BetterSqlite3(older);
  // VACUUM so the file is no larger than the one it replaces, which is what paging it back in requires.
  db.exec('DROP TABLE event_items; VACUUM;');
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'event_items'").get()).toEqual({ n: 0 });
  db.close();
  await replaceTheDatabase(page, readFileSync(older));

  await page.goto('/events');
  await page.getByTestId('event-row').click();
  await page.getByTestId('open-plan').click();
  await expect(page.getByText(/This copy of your data is from before a plan was a list of things to buy/)).toBeVisible();

  // And the form says the same thing again with its Save turned off, rather than taking an item it cannot keep.
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await expect(page.getByText(/This copy of your data is from before a plan was a list of things to buy/)).toBeVisible();
  await page.getByLabel('What', { exact: true }).fill('Crib');
  await page.getByLabel('Price each').fill('7500000');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
});

/**
 * A receipt that answered four items says all four of them — on the wide screen, which has room.
 *
 * The history's pills were capped at three with a "+N more" on both shells at once, to stop eight pills wrapping
 * and growing a row taller than the day card around it. That is a 390px problem: a desktop day card fits them.
 * Desktop is this product's strongest tier and is never made poorer to fix the phone, so the cap lives in the phone
 * shell alone — `phone-event-plan.spec.ts` holds the other half of this, where the cap is what is asserted.
 */
test('the desktop history names every item a receipt answered, with nothing folded into a count', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Mothercare', '4150000');
  await addEvent(page, 'Newborn');
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Newborn clothes', price: '1000000', category: 'Food and beverage' });
  for (const item of [
    { name: 'Muslin wraps', price: '700000' },
    { name: 'Bottle steriliser', price: '800000' },
    { name: 'Nappies', price: '500000' },
  ]) {
    await addItem(page, { ...item, category: 'Food and beverage' });
  }

  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Mothercare' }).click();
  await page.getByRole('link', { name: 'See the whole plan' }).click();
  await page.getByTestId('plan-item').filter({ hasText: 'Newborn clothes' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a purchase' }).click();
  await page.getByRole('link', { name: /Mothercare/ }).click();
  for (const name of ['Muslin wraps', 'Bottle steriliser', 'Nappies']) await page.getByRole('checkbox', { name }).check();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Back to the event' }).click();
  const receipt = page.getByTestId('event-history').filter({ hasText: 'Mothercare' });
  await expect(receipt).toBeVisible();
  for (const name of ['Newborn clothes', 'Muslin wraps', 'Bottle steriliser', 'Nappies']) await expect(receipt).toContainText(name);
  // Nothing folded away, and the leftover still said: four pills and the amber one, never a count in place of a name.
  await expect(receipt.getByText(/\+\d+ more/)).toHaveCount(0);
  await expect(receipt).toContainText('not planned');
});
