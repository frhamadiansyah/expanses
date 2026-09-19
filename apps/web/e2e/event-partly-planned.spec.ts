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

  // The tickets are planned and nothing else is — an item filed in no category at all.
  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Museum tickets', quantity: '4', price: '875000' });
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
   */
  await expectFigures(sheet, { 'Not planned': 'Rp 9.200.000', 'Total spent': 'Rp 9.200.000' });

  // Where it went keeps every category, and says which ones were never planned.
  await sheet.getByRole('button', { name: 'Where it went' }).click();
  await expect(page.getByTestId('event-detail-sheet')).toContainText('no items');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('9.200.000');
  // The Plan card holds only what was planned.
  await expect(page.getByTestId('event-plan-card')).toContainText('No category');
  await expect(page.getByTestId('event-plan-card')).toContainText('1 item · none bought');
});
