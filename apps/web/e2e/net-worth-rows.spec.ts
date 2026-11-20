import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { openDrawers } from './drawers';

// On a wide screen (the Mac page) a click on a row is its peek and a double-click its page.
test('each account in Net worth’s rows opens its own page', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'time_deposit', name: 'Six month deposit', balance: '50000000', matures: '2099-01-15' });
  await page.goto('/net-worth');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Everyday/ }).first().dblclick();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Everyday' })).toBeVisible();
  // Money kept for spending opens as its own Mac page; Back goes back to Net worth, where it was opened from.
  await expect(page.getByTestId('account-desk')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/net-worth$/);

  await page.goto('/net-worth');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Six month deposit/ }).first().dblclick();
  await expect(page.getByRole('heading', { name: 'Six month deposit' })).toBeVisible();
});
