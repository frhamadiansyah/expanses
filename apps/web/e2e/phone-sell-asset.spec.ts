import { expect, test } from '@playwright/test';
import { bankAndLaptop, expectSoldPage, expectWaysOut, laptopSettings, sellLaptop } from './sell-asset';

test('by thumb: Sell is the first row of the one box of ways out, and the sale reads Sold', async ({ page }) => {
  await bankAndLaptop(page);
  await laptopSettings(page);
  await expectWaysOut(page);
  await page.getByRole('main').getByRole('button', { name: 'Sell', exact: true }).tap();
  const sheet = page.getByRole('dialog');
  // A sheet that only closes: the ✕ and no ✓ in the corner.
  await expect(sheet.getByRole('button', { name: /^(Close|Cancel)/ }).first()).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^(Done|Save|Record)$/ })).toHaveCount(0);
  await sheet.getByRole('button', { name: /^(Close|Cancel)/ }).first().tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await sellLaptop(page);
  await expectSoldPage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
