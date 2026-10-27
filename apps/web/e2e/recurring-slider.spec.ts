import { expect, test } from '@playwright/test';
import { showMonthly, showRepeating } from './bill-form';
import { addFarYearlyBill, addMonthlyBill } from './recurring-slider';

test('Recurring slides from Monthly to Repeating: its hero, and one list of the repeating bills', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  await expect(page.getByTestId('bills-summary')).toContainText('Still to pay in');
  await expect(page.getByTestId('bill-row').filter({ hasText: 'Water' })).toBeVisible();
  await expect(page.getByTestId('yearly-bills-row')).toHaveCount(0);
  await expect(page.getByTestId('yearly-bill-row')).toHaveCount(0);

  await showRepeating(page);
  const hero = page.getByTestId('repeating-summary');
  await expect(hero).toContainText('Set aside · per month');
  await expect(hero).toContainText('No sinking funds yet');
  await expect(page.getByTestId('bill-row')).toHaveCount(0);
  const domain = page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' });
  await expect(domain).toContainText('3.000.000');
  await expect(domain.getByRole('progressbar')).toHaveCount(0);

  // A row opens its bill, and coming back keeps the page.
  await domain.click();
  await expect(page.getByRole('heading', { name: 'Domain' })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('repeating-summary')).toBeVisible();
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' })).toBeVisible();

  await showMonthly(page);
  await expect(page.getByTestId('bills-summary')).toContainText('Still to pay in');
  await expect(page.getByTestId('bill-row').filter({ hasText: 'Water' })).toBeVisible();
});

test('the arrow keys and a scroll of the hero change the page too', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  const slider = page.getByRole('group', { name: 'Recurring', exact: true });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repeating' })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('bill-row').filter({ hasText: 'Water' })).toBeVisible();

  await expect.poll(() => slider.evaluate((el) => el.scrollLeft)).toBe(0);
  await slider.evaluate((el) => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }));
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' })).toBeVisible();
});

test('with nothing repeating, the Repeating list says so', async ({ page }) => {
  await page.goto('/bills');
  await showRepeating(page);
  await expect(page.getByTestId('repeating-summary')).toContainText('No sinking funds yet');
  await expect(page.getByTestId('repeating-empty')).toContainText('No repeating bills yet');
});
