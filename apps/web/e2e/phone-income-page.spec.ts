import { expect, test } from '@playwright/test';
import { addPriced } from './asset-page';
import { ALL_TRADES, INCOME, tradeRow } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/*
 * Income on a phone: the year's two figures side by side, the trades under them by day, and a line opened by thumb
 * onto its holding. The wide screen's holdings table stays off a phone, and nothing runs off the right edge.
 */
test('by thumb: Income reads the year side by side and opens a trade’s holding', async ({ page }) => {
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2026-03-09', '10', '18000000']]);

  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Income', exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`${INCOME}$`));
  const year = page.getByTestId('trades-year');
  await expect(year).toContainText('Realized this year');
  await expect(year).toContainText('Income this year');
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The trades are a page of their own, from the foot of Assets' Investments.
  await page.goto('/net-worth/assets');
  await page.getByTestId('all-trades').tap();
  await expect(page).toHaveURL(new RegExp(`${ALL_TRADES}$`));
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
