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

  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await expect(page.getByTestId('plan-totals')).toContainText('Not planned');
  // The amber pill on the receipt's own row, beside the item it did not buy — not the summary's "Not planned".
  await expect(page.getByText('not planned', { exact: true })).toBeVisible();
  await expect(page.getByTestId('plan-totals')).toContainText('4.200.000');
});
