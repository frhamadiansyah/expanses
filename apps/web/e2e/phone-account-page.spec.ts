import { expect, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';

import { mockRates, openWithPockets } from './pockets';

test('by thumb: an account page spends from itself, and a pocket goes back to its account', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await page.getByRole('link', { name: 'Everyday', exact: true }).tap();
  await expect(page.getByTestId('account-recent')).toContainText('Opening balance');
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Tax report code/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Spend', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'New expense' }).getByRole('button', { name: 'Paid with' })).toContainText('Everyday');
  await page.getByRole('dialog', { name: 'New expense' }).getByRole('button', { name: 'Close' }).tap();

  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await openTypes(page);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).tap();
  await page.getByTestId('pocket-SGD').tap();
  await expect(page.getByRole('heading', { name: 'Valas Plus · SGD' })).toBeVisible();
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).tap();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
