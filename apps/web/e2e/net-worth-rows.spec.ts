import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { openDrawers } from './drawers';

test('each account in Net worth’s drawers opens its own page', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openAccount(page, { subtype: 'time_deposit', name: 'Six month deposit', balance: '50000000', matures: '2099-01-15' });
  await page.goto('/');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Everyday/ }).first().click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Everyday' })).toBeVisible();

  await page.goto('/');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Six month deposit/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Six month deposit' })).toBeVisible();
});
