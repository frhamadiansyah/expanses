import { expect, test } from '@playwright/test';
import { addPriced } from './asset-page';
import { ALL_TRADES, INCOME, tradeRow } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/*
 * Income and All trades on a phone: Income says plainly when nothing held pays; All trades has the year's realized
 * figure over the trades by day, and a line opened by thumb onto its holding. The wide screen's holdings table stays
 * off a phone, and nothing runs off the right edge.
 */
test('by thumb: Income and All trades fit the screen, and a trade’s line opens its holding', async ({ page }) => {
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2026-03-09', '10', '18000000']]);

  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Income', exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`${INCOME}$`));
  // Gold pays nothing, so there is no year to draw, and no trade figure here any more.
  await expect(page.getByText(/No listed shares or bonds with a coupon yet/)).toBeVisible();
  await expect(page.getByText('Realized this year')).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The trades are a page of their own, from the foot of Assets' Investments.
  await page.goto('/net-worth/assets');
  await page.getByTestId('all-trades').tap();
  await expect(page).toHaveURL(new RegExp(`${ALL_TRADES}$`));
  await expect(page.getByLabel('Realized this year', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tradeRow(page, 'Bought Antam gold bars').tap();
  await expect(page.getByRole('heading', { name: 'Antam gold bars' })).toBeVisible();
  // The line's ⋮ there carries what Buy & sell set on it: Edit and Delete, and Goals… only once a goal exists.
  await page.getByRole('button', { name: /^More for Bought 10 g/ }).tap();
  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Delete' }) });
  await expect(sheet.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Goals…/ })).toHaveCount(0);
});
