import { expect, test } from '@playwright/test';

test('a weekly line is shown and counted as 52/12 of a week', async ({ page }) => {
  await page.goto('/budget');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await page.getByLabel('Every').selectOption('weekly');
  const amount = page.getByLabel('Weekly amount (IDR)');
  await amount.click();
  await amount.pressSequentially('500000', { delay: 30 });
  await expect(page.getByText('Per month')).toBeVisible();
  await expect(page.locator('body')).toContainText('2.166.667');
  await page.getByRole('button', { name: 'Set budget' }).click();

  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');
  await expect(page.getByTestId('line-Groceries')).toContainText('500.000');
  await expect(page.getByTestId('line-Groceries')).toContainText('a week');
});
