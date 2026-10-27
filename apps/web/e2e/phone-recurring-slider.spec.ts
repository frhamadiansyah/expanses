import { expect, test } from '@playwright/test';
import { showMonthly, showRepeating } from './bill-form';
import { addFarYearlyBill, addMonthlyBill } from './recurring-slider';

test('on a phone, Recurring slides to Repeating by its dot, and a repeating row opens its bill', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  await expect(page.getByTestId('bills-summary')).toContainText('Still to pay in');
  await expect(page.getByTestId('yearly-bills-row')).toHaveCount(0);

  await showRepeating(page);
  await expect(page.getByTestId('repeating-summary')).toContainText('Set aside · per month');
  await expect(page.getByTestId('repeating-summary')).toContainText('No sinking funds yet');
  const domain = page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' });
  await expect(domain).toContainText('3.000.000');
  await expect(page.getByTestId('bill-row')).toHaveCount(0);
  await domain.click();
  await expect(page.getByRole('heading', { name: 'Domain' })).toBeVisible();
});

test('on a phone, swiping the hero moves the page, and the next card peeks in at the edge', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  const slider = page.getByRole('group', { name: 'Recurring', exact: true });
  const box = await slider.boundingBox();
  const next = await page.locator('[aria-roledescription=slide][aria-label=Repeating]').boundingBox();
  // The second card starts inside the slider's width: a peek.
  expect(next!.x).toBeLessThan(box!.x + box!.width);
  expect(next!.x).toBeGreaterThan(box!.x + box!.width * 0.8);

  await slider.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(page.getByTestId('repeating-summary')).toBeVisible();
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repeating' })).toHaveAttribute('aria-current', 'true');
});
