import { expect, test } from '@playwright/test';
import { expectWalletFigure } from './accounts';
import { bankAndLaptop, expectSoldPage, expectWaysOut, laptopSettings, sellLaptop } from './sell-asset';

test('an estimated asset is sold from Settings, shows in Sold and archived, and the sale is undone', async ({ page }) => {
  await bankAndLaptop(page);
  await laptopSettings(page);
  await expectWaysOut(page);
  await sellLaptop(page);
  await expectSoldPage(page);

  // The money came in: one transaction, the total, into the bank account.
  await page.goto('/transactions');
  await expect(page.getByText('Sold Laptop').first()).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '28.500.000');

  // Off the list and out of its total; in the grey group, folded until opened.
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /^Laptop/ })).toHaveCount(0);
  const toggle = page.getByTestId('gone-toggle');
  await expect(toggle).toContainText('Sold and archived');
  await expect(page.locator('[data-testid^="gone-row-"]')).toHaveCount(0);
  await toggle.click();
  const row = page.locator('[data-testid^="gone-row-"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Laptop');
  await expect(row).toContainText('Sold');
  await expect(row).toContainText('Rp 20.000.000');
  await row.click();
  await expectSoldPage(page);

  // Undo puts everything back: the page has its value again, the list its row, the account its balance.
  await page.getByRole('button', { name: 'Undo sale' }).click();
  await expect(page.getByText('Value now')).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '9.000.000');
  await page.goto('/net-worth/assets');
  await expect(page.getByTestId('gone-toggle')).toHaveCount(0);
});

test('an archived asset is listed in the group and restored from its page', async ({ page }) => {
  await bankAndLaptop(page);
  await laptopSettings(page);
  // Archiving wants nothing left in it: no cost, no value.
  const cost = page.getByLabel('Original cost', { exact: true });
  await cost.fill('');
  await cost.blur();
  await page.getByRole('button', { name: /^Value/ }).click();
  await page.getByLabel('Value (IDR)').fill('0');
  await page.getByRole('button', { name: 'Save value' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  await page.getByTestId('gone-toggle').click();
  const row = page.locator('[data-testid^="gone-row-"]');
  await expect(row).toContainText('Laptop');
  await expect(row).toContainText('Archived');
  await row.click();
  await expect(page.getByTestId('archived-word')).toHaveText('Archived');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('archived-word')).toHaveCount(0);
  await expect(page.getByText('Value now')).toBeVisible();
  await page.goto('/net-worth/assets');
  await expect(page.getByTestId('gone-toggle')).toHaveCount(0);
});
