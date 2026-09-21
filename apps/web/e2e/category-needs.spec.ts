import { expect, test } from '@playwright/test';

test('a parent’s mark reaches its children, a child can keep its own, and clearing hands it back', async ({ page }) => {
  await page.goto('/categories');
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Essential');

  await page.getByRole('button', { name: 'Mark Food and beverage lifestyle' }).click();
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Lifestyle (from parent)');

  await page.getByRole('button', { name: 'Mark School catering essential' }).click();
  await expect(page.getByTestId('need-School catering')).toHaveText('Essential');

  await page.getByRole('button', { name: 'Clear the mark on School catering' }).click();
  await expect(page.getByTestId('need-School catering')).toHaveText('Lifestyle (from parent)');
  await expect(page.getByTestId('need-Groceries')).toHaveText('Essential');
});
