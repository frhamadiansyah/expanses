import { expect, test } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { balanceOnGridOnly, forSpendingOff, walletReorder, walletViews } from './wallet';

test('an account switched off For spending leaves Wallet and Paid with, and stays on Assets and in a transfer’s To', async ({ page }) => {
  await forSpendingOff(page);
});

test('the Balance box is always over the grid and nowhere else, with no eye', async ({ page }) => {
  await balanceOnGridOnly(page);
});

test('View lays the cards out as a grid with captions or a carousel with the shown card’s Recent, remembers the choice, and Stack puts the pile back', async ({ page }) => {
  await walletViews(page);
});

test('Reorder cards puts a credit card in front of the money in all three views, keeps it over a reload, and ‹ keeps nothing', async ({ page }) => {
  await walletReorder(page);
});

/*
 * A bank account's debit card rewards are reached from the account's Settings, not from a group on Wallet: the row says
 * "Not set up" until the account has a programme, and opens the account as a card, where one is set up.
 */
test('Card rewards is a row of a bank account’s Settings, not a group on Wallet', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '3000000' });
  await page.goto('/wallet');
  await expect(walletCard(page, 'Everyday')).toBeVisible();
  await expect(page.getByText('Earning on a debit card?')).toHaveCount(0);

  await walletCard(page, 'Everyday').click();
  await expect(page).toHaveURL(/\/accounts\/([^/]+)$/);
  const accountId = /\/accounts\/([^/]+)$/.exec(page.url())![1]!;
  // Not on the account's page itself any more…
  await expect(page.getByRole('button', { name: /Card rewards/ })).toHaveCount(0);
  await page.locator('header').getByRole('link', { name: 'Settings', exact: true }).click();
  // …but in its Settings, saying it is not set up yet, and opening the account as a card.
  const row = page.getByRole('button', { name: /Card rewards/ });
  await expect(row).toContainText('Card rewards');
  await expect(row).toContainText('Not set up');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/cards/${accountId}$`));
});
