import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';

/*
 * The wide screen's Overview (Mac Overview A, 2026-11-17): the first page on a wide screen, first in the sidebar, its
 * boxes reading figures the app already has. Invented data.
 */
test.beforeEach(async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('opens first on a wide screen and shows money on hand, the accounts and the boxes', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Satu', balance: '90000000' });
  await openAccount(page, { subtype: 'cash', name: 'Dompet', balance: '10000000' });

  await page.goto('/');
  await expect(page).toHaveURL(/\/overview$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.locator('aside nav').getByRole('link').first()).toHaveText('Overview');
  await expect(page.locator('aside nav').getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

  // Money on hand is Wallet's Balance: the two accounts, nothing owed and no bills.
  await expect(page.getByTestId('overview-on-hand')).toHaveText(/100\.000\.000/);

  const accounts = page.getByRole('region', { name: 'Accounts' });
  await expect(accounts).toContainText('2 accounts');
  await expect(accounts.locator('a[href^="/accounts/"]')).toHaveText([/^Bank Satu\s*90 jt/, /^Dompet\s*10 jt/]);

  // Nothing spent yet: Expected has nothing to go on, and How long it lasts has nothing to measure by.
  await expect(page.getByTestId('overview-expected')).toHaveText('Expected: nothing to go on yet');
  await expect(page.getByRole('region', { name: 'How long it lasts' })).toContainText('6 months');

  await expect(page.getByRole('region', { name: 'Worth a look' })).toContainText('Never backed up');
  await expect(page.getByRole('region', { name: 'Next 14 days' })).toContainText('Nothing due in the next 14 days.');

  // The range moves a month at a time.
  const range = page.getByTestId('overview-range');
  const before = await range.innerText();
  await page.getByRole('button', { name: 'Earlier months' }).click();
  await expect(range).not.toHaveText(before);
  await page.getByRole('button', { name: 'Later months' }).click();
  await expect(range).toHaveText(before);

  // A box's title opens its page; ＋ Add opens the Add screen.
  await page.getByRole('region', { name: 'Accounts' }).getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await page.goto('/overview');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page).toHaveURL(/\/transactions\/new$/);
});
