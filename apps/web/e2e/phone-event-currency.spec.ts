import { expect, type Page, test } from '@playwright/test';
import { chooseCategory, showPlanCard, TODAY } from './event-plan';
import { mockRates } from './pockets';

/*
 * An event with a currency of its own, and plan items in currencies of their own.
 *
 * The workspace stays in rupiah. The trip is planned in lira; a flight is priced in rupiah and a museum pass in euros,
 * so two of the three items are converted at the day's rate (mocked below) and the plan totals in lira, with the
 * rupiah equivalent under the total. Everything is found by role and name, as the other phone specs do.
 */

async function pickCurrency(page: Page, code: string) {
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${code} `) }).first().click();
}

test('a trip planned in lira holds items in rupiah and euros and totals them in lira', async ({ page }) => {
  // One euro is Rp 18.000 and one lira Rp 400, so Rp 9.800.000 is ₺ 24.500 and € 95 is ₺ 4.275.
  await mockRates(page, { EUR: 18_000, TRY: 400 });

  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill('Turkey trip');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  // The row says which currency the plan is in, the workspace's until another is picked.
  await expect(page.getByRole('button', { name: 'Currency: IDR' })).toBeVisible();
  await page.getByRole('button', { name: 'Currency: IDR' }).click();
  await pickCurrency(page, 'TRY');
  await expect(page.getByRole('button', { name: 'Currency: TRY' })).toBeVisible();
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Turkey trip', exact: true })).toBeVisible();

  await showPlanCard(page);
  await page.getByTestId('open-plan').click();

  // Flight: starts in lira, the price is rupiah. The category goes through the sheet of marks.
  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await page.getByLabel('What', { exact: true }).fill('Flight');
  await expect(page.getByRole('button', { name: 'Currency: TRY' })).toBeVisible();
  await page.getByRole('button', { name: 'Currency: TRY' }).click();
  await pickCurrency(page, 'IDR');
  await page.getByLabel('Price each').fill('9800000');
  await chooseCategory(page, 'Food and beverage');
  await expect(page.getByRole('button', { name: 'Category, Food and beverage' })).toBeVisible();
  await expect(page.getByLabel('Estimate')).toHaveValue(/24\.500/);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Flight' })).toContainText('≈');
  // The category it was given through the sheet is the one it was saved under.
  await expect(page.getByTestId('plan-category').filter({ hasText: 'Food and beverage' })).toContainText('Flight');

  // Museum pass: euros.
  await page.getByRole('link', { name: 'Add a cost' }).first().click();
  await page.getByLabel('What', { exact: true }).fill('Museum pass');
  await page.getByRole('button', { name: 'Currency: TRY' }).click();
  await pickCurrency(page, 'EUR');
  await page.getByLabel('Price each').fill('95');
  await expect(page.getByLabel('Estimate')).toHaveValue(/≈.*4\.275/);
  await page.getByRole('button', { name: 'Save' }).click();
  const museum = page.getByTestId('plan-item').filter({ hasText: 'Museum pass' });
  // Its own price under the name, its worth in lira beside it.
  await expect(museum).toContainText('95');
  await expect(museum).toContainText('≈');

  // 24.500 + 4.275 lira, and the rupiah those are: 9.800.000 + 1.710.000.
  await expect(page.getByTestId('plan-planned')).toContainText('28.775');
  await expect(page.getByTestId('plan-planned-base')).toContainText('11.510.000');
});
