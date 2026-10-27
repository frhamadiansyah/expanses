import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * Cashflow's ring is drawn in the colour of each category's own mark (not a colour worked out from its id), so the ring,
 * its rows and the category marks always agree. Invented figures: Rp 85.000 at Warung Makan Sederhana.
 */
test('the ring slice for Food and beverage is the same colour as its category mark', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Makan Sederhana', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '85000' });

  const report = page.getByTestId('spending-report');
  const slice = report.locator('svg path[stroke]').first();
  await expect(slice).toBeVisible();
  const ring = await slice.evaluate((el) => getComputedStyle(el).stroke);

  const mark = page.getByTestId('transaction-row').filter({ hasText: 'Warung Makan Sederhana' }).getByTestId('category-mark').first();
  await expect(mark).toBeVisible();
  const markColour = await mark.evaluate((el) => getComputedStyle(el).color);
  expect(ring).toBe(markColour);
  // Food and beverage's own orange, not a wheel colour.
  expect(markColour).toBe('rgb(234, 88, 12)');
});
