import { expect, test } from '@playwright/test';
import { addEvent, addWallet, expectFigures, fillItem } from './event-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/**
 * The case the whole design turns on: a plan is per category, so an event may plan some things and not others.
 *
 * You list the museum tickets and not the hotel. The ring must then measure the tickets alone — Rp9.200.000 of food
 * nobody planned is not Rp5.700.000 over a Rp3.500.000 ticket plan — while the chart one swipe back still shows every
 * rupiah tagged to the trip, and the rows under it still name the categories that were never part of the plan.
 */
test('planning one category never calls the rest of the trip over plan', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Bali holiday');
  // Recorded through the event's own card, so it is tagged without needing a category the plan names yet.
  await page.getByRole('button', { name: 'Add spending' }).click();
  await page.getByLabel('Description').fill('Hotel Uluwatu');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Food and beverage' });
  await page.getByLabel('Amount', { exact: true }).fill('9200000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('event-total')).toContainText('9.200.000');

  // The tickets are planned and nothing else is.
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Museum tickets', quantity: '4', price: '875000', category: 'Transportation' });
  /*
   * And bought, for a little under the estimate.
   *
   * Not decoration: with nothing bought, "Not planned" and "Total spent" are the same figure by definition — money
   * no item claims is all the money there is — and two equal figures in an order-insensitive map cannot say which
   * label belongs to which, so swapping the two labels passed. One purchase against one item parts them, and the
   * difference it leaves is a third figure again, so all three rows under the ring are pinned to their own words.
   */
  await page.getByTestId('plan-item').filter({ hasText: 'Museum tickets' }).getByRole('link').click();
  await page.getByRole('button', { name: 'Buy it now' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('3500000');
  await page.getByLabel('Amount', { exact: true }).fill('3400000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Museum tickets' })).toContainText('3.400.000');
  await page.getByRole('link', { name: 'Back to the event' }).click();

  const sheet = page.getByTestId('event-sheet');
  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  // Rp9.200.000 of food nobody planned is not Rp5.700.000 over a Rp3.500.000 ticket plan.
  await expect(sheet).not.toContainText('Over the plan by');
  await expect(sheet).toContainText('Planned so far');
  await expect(sheet).toContainText('3.500.000');
  // And the ring says which spending it is counting, beside the whole-trip total the chart behind it shows.
  await expect(sheet).toContainText('Spent on plan');
  /*
   * Read as label → figure, and not as `toContainText('Total spent')`, which proved nothing: the donut one swipe
   * behind prints "Total spent" as its own label, so that assertion passed off the chart and would have passed with
   * this row deleted — the very reconciliation it was written to hold. Here the row is a key with the chart's own
   * figure beside it, so a row that is gone is a key that is missing.
   *
   * Worked by hand: Rp3.400.000 paid against a Rp3.500.000 estimate is Rp100.000 under; the hotel answers no item,
   * so Rp9.200.000 was never planned; and the whole trip comes to Rp12.600.000. Three different figures, so no two
   * of these labels can be swapped without the map saying so.
   */
  await expectFigures(sheet, { 'Difference so far': '−Rp 100.000', 'Not planned': 'Rp 9.200.000', 'Total spent': 'Rp 12.600.000' });

  // Where it went keeps every category, and says which ones were never planned.
  await sheet.getByRole('button', { name: 'Where it went' }).click();
  await expect(page.getByTestId('event-detail-sheet')).toContainText('no items');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('9.200.000');
  // The Plan card holds only what was planned.
  await expect(page.getByTestId('event-plan-card')).toContainText('Transportation');
  await expect(page.getByTestId('event-plan-card')).toContainText('1 item · 1 bought');
});
