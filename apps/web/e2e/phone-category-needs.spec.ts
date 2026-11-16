import { expect, test } from '@playwright/test';
import { expectNeed, markNeed, openCategory } from './categories';

test('a parent’s mark reaches its children, a child can keep its own, and clearing hands it back', async ({ page }) => {
  // Built in by key: Restaurants is Lifestyle with nothing marked (owner, 16 Nov 2026).
  await openCategory(page, 'Restaurants');
  await expectNeed(page, 'Restaurants', 'Lifestyle', 'Built in');
  // Why it matters sits behind the ⓘ beside Spending, not in a footer.
  await expect(page.getByText(/Sets the emergency fund size and the Budget split/)).toHaveCount(0);
  await page.getByRole('button', { name: 'About Spending' }).click();
  await expect(page.getByText(/Sets the emergency fund size and the Budget split/)).toBeVisible();

  // A mark set on the parent wins over the built-in one.
  await markNeed(page, 'Food and beverage', 'Essential');
  await openCategory(page, 'Restaurants');
  await expectNeed(page, 'Restaurants', 'Essential', 'Follows Food and beverage');
  await markNeed(page, 'Food and beverage', 'Lifestyle');
  await openCategory(page, 'Restaurants');
  await expectNeed(page, 'Restaurants', 'Lifestyle', 'Follows Food and beverage');

  await markNeed(page, 'School catering', 'Essential');

  await page.getByRole('button', { name: 'Clear the mark on School catering' }).click();
  await expectNeed(page, 'School catering', 'Lifestyle', 'Follows Food and beverage');
  await expect(page.getByRole('button', { name: 'Clear the mark on School catering' })).toHaveCount(0);

  await openCategory(page, 'Groceries');
  await expectNeed(page, 'Groceries', 'Essential', 'Built in');
});

test('the third mark: insurance is Debts & savings built in, and any category can be given it', async ({ page }) => {
  await openCategory(page, 'Life insurance');
  await expectNeed(page, 'Life insurance', 'Debts & savings', 'Built in');
  await markNeed(page, 'Groceries', 'Debts & savings');
  await page.getByRole('button', { name: 'Clear the mark on Groceries' }).click();
  await expectNeed(page, 'Groceries', 'Essential', 'Built in');
});
