import { expect, test } from '@playwright/test';
import { openDrawer } from './budget';

test('a yearly line is typed at phone width and counted as a twelfth of the year', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add a budget' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await sheet.getByLabel('Every').selectOption('yearly');
  const amount = sheet.getByLabel('Cap', { exact: true });
  await amount.click();
  await amount.pressSequentially('2400000', { delay: 30 });
  await expect(sheet.getByText('Per month')).toBeVisible();
  await expect(sheet).toContainText('200.000');
  await sheet.getByRole('button', { name: 'Save budget' }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openDrawer(page, 'Household');
  await expect(page.getByTestId('line-Groceries')).toContainText('left of 200.000');
  await page.getByTestId('line-Groceries').tap();
  await expect(page.getByRole('dialog', { name: 'Groceries' }).getByLabel('Cap', { exact: true })).toHaveValue('2.400.000');
  await expect(page.getByRole('dialog', { name: 'Groceries' }).getByLabel('Every')).toHaveValue('yearly');
});
