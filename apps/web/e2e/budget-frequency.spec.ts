import { expect, test } from '@playwright/test';
import { budgetTab, openCapOf, openDrawer, openNewCap } from './budget';

test('a weekly line is shown and counted as 52/12 of a week', async ({ page }) => {
  await page.goto('/budget');
  const sheet = await openNewCap(page);
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await sheet.getByLabel('Every').selectOption('weekly');
  const amount = sheet.getByLabel('Cap', { exact: true });
  await amount.click();
  await amount.pressSequentially('500000', { delay: 30 });
  await expect(sheet.getByText('Per month')).toBeVisible();
  await expect(sheet).toContainText('2.166.667');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Folded under its parent, and read a month at a time.
  await openDrawer(page, 'Household');
  await expect(page.getByTestId('line-Groceries')).toContainText('left of 2.166.667');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');

  // The cap keeps the unit it was typed in.
  const again = await openCapOf(page, '— Groceries');
  await expect(again.getByLabel('Cap', { exact: true })).toHaveValue('500.000');
  await expect(again.getByLabel('Every')).toHaveValue('weekly');
});
