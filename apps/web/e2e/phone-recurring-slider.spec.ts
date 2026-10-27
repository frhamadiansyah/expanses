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
  await expect(page.getByTestId('repeating-summary')).toContainText('Needed · per month, from now');
  await expect(page.getByTestId('repeating-summary')).toContainText('Not set aside');
  const domain = page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' });
  await expect(domain).toContainText('3.000.000');
  await expect(page.getByTestId('bill-row')).toHaveCount(0);
  await domain.click();
  await expect(page.getByRole('heading', { name: 'Domain' })).toBeVisible();
});

test('on a phone, swiping the hero moves the page, and the card fills the width with no peek', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  const slider = page.getByRole('group', { name: 'Recurring', exact: true });
  const box = await slider.boundingBox();
  const next = await page.locator('[aria-roledescription=slide][aria-label=Repeating]').boundingBox();
  // The second card starts where the slider ends: the dots say there is another page, the card shows no edge of it.
  expect(next!.x).toBeGreaterThanOrEqual(box!.x + box!.width - 1);

  await slider.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(page.getByTestId('repeating-summary')).toBeVisible();
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repeating' })).toHaveAttribute('aria-current', 'true');
});
