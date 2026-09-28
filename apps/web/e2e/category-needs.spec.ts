import { expect, test } from '@playwright/test';
import { expectNeed, markNeed, openCategory } from './categories';

test('a parent’s mark reaches its children, a child can keep its own, and clearing hands it back', async ({ page }) => {
  await openCategory(page, 'Restaurants');
  await expectNeed(page, 'Restaurants', 'Essential', null);

  await markNeed(page, 'Food and beverage', 'Lifestyle');
  await openCategory(page, 'Restaurants');
  await expectNeed(page, 'Restaurants', 'Lifestyle', 'Follows Food and beverage');

  await markNeed(page, 'School catering', 'Essential');

  await page.getByRole('button', { name: 'Clear the mark on School catering' }).click();
  await expectNeed(page, 'School catering', 'Lifestyle', 'Follows Food and beverage');
  await expect(page.getByRole('button', { name: 'Clear the mark on School catering' })).toHaveCount(0);

  await openCategory(page, 'Groceries');
  await expectNeed(page, 'Groceries', 'Essential', null);
});
