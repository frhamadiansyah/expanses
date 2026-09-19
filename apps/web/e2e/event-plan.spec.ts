import { expect, test } from '@playwright/test';
import { addEvent, addItem, addWallet, fillItem, spend } from './event-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

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
  await expect(page.getByTestId('plan-totals')).toContainText('Not planned');
  // The amber pill on the receipt's own row, beside the item it did not buy — not the summary's "Not planned".
  await expect(page.getByText('not planned', { exact: true })).toBeVisible();
  await expect(page.getByTestId('plan-totals')).toContainText('4.200.000');
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
