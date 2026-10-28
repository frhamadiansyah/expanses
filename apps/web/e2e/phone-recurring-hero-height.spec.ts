import { expect, test } from '@playwright/test';
import { showMonthly, showRepeating } from './bill-form';
import { addFarYearlyBill, addMonthlyBill } from './recurring-slider';

test('on a phone, the Monthly and Repeating hero cards are the same height with different legend items', async ({ page }) => {
  // One overdue monthly bill (one legend item) against one unfunded repeating bill (one item): different from the
  // three a busy month shows, yet both reserve three lines.
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  const monthly = (await page.getByTestId('bills-summary').boundingBox())!;
  await expect(page.getByTestId('bills-legend').locator('li')).toHaveCount(1);
  await showRepeating(page);
  const repeating = (await page.getByTestId('repeating-summary').boundingBox())!;
  await expect(page.getByTestId('repeating-legend').locator('li')).toHaveCount(1);
  expect(Math.abs(monthly.height - repeating.height)).toBeLessThanOrEqual(1);
  // Each legend keeps three 26 px lines.
  expect((await page.getByTestId('repeating-legend').boundingBox())!.height).toBeGreaterThanOrEqual(78);
});
