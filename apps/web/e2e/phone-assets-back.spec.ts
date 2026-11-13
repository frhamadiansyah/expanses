import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset, pastPurchase } from './add-asset';
import { addEstimated } from './asset-page';
import { openDrawer } from './drawers';

/*
 * Assets folds its rows into drawers. A fund opened from one and gone Back from used to come up with every drawer shut
 * and the page at the top; Back now returns to the page as it was left.
 */
test('Back from a fund returns to Assets with the drawer open and the page where it was', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '9000000' });
  for (const [name, now] of [['Laptop', '14000000'], ['Phone', '9000000'], ['Camera', '7000000'], ['Tablet', '6000000'], ['Watch', '5000000'], ['Monitor', '4000000']] as const) {
    await addEstimated(page, 'Electronics', name, '2024-01-05', '22000000', now);
  }
  await openNewAsset(page, 'Mutual fund');
  await page.getByLabel('Name', { exact: true }).fill('Sucor Money Market');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-01-15');
  await page.getByLabel('Amount', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  // Open the electronics drawer too, so the page is tall enough to scroll, then the fund's.
  await openDrawer(page, 'Electronics');
  await openDrawer(page, 'Mutual fund');
  const fund = page.getByRole('link', { name: /^Sucor Money Market/ }).first();
  await expect(fund).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
  const before = await page.evaluate(() => window.scrollY);

  await fund.click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/.+/);
  await page.goBack();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  await expect(page.locator('[data-testid^="type-drawer-"]').filter({ hasText: 'Mutual fund' }).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: /^Sucor Money Market/ }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 20);
});
