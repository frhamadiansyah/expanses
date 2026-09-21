import { expect, test } from '@playwright/test';

test('a yearly line is typed at phone width and counted as a twelfth of the year', async ({ page }) => {
  await page.goto('/budget');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await page.getByLabel('Every').selectOption('yearly');
  const amount = page.getByLabel('Yearly amount (IDR)');
  await amount.click();
  await amount.pressSequentially('2400000', { delay: 30 });
  await expect(page.getByText('Per month')).toBeVisible();
  await expect(page.locator('body')).toContainText('200.000');
  await page.getByRole('button', { name: 'Set budget' }).click();

  await expect(page.getByTestId('caps-total')).toContainText('200.000');
  await expect(page.getByTestId('line-Groceries')).toContainText('2.400.000');
  await expect(page.getByTestId('line-Groceries')).toContainText('a year');
});
