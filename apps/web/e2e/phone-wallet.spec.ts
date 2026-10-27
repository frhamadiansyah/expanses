import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { balanceOnGridOnly, forSpendingOff, walletReorder, walletViews } from './wallet';

/** The same Wallet journeys as `wallet.spec.ts`, at a phone's width with its tab bar. */
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

test('the ⋯ menu opens where it can be seen with the page scrolled down, not only at the top', async ({ page }) => {
  for (const name of ['Everyday', 'Rainy day', 'Travel', 'Pocket cash']) await openAccount(page, { subtype: 'bank', name, balance: '1000000' });
  await page.goto('/wallet');
  await expect(page.getByRole('region', { name: 'Cards' }).getByTestId('wallet-card')).toHaveCount(4);
  // The pile's corners: View, + and ⋯ — the card tools wait behind the ⋯.
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Which card?' })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(80);
  // Scrolled past the title, the corner is the pinned bar's; its ⋯ opens a menu that is on the screen.
  await page.locator('button[aria-label="More"]').last().click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu).toBeVisible();
  await expect(menu).toBeInViewport();
  await expect(menu.getByRole('menuitem', { name: 'Which card?' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Which card?' }).click();
  await expect(page).toHaveURL(/\/recommend$/);
});

test('Wallet’s + opens the credit card form straight away, with no debt to choose first', async ({ page }) => {
  await page.goto('/wallet');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Credit card' }).click();
  await expect(page).toHaveURL(/\/cards\/new$/);
  await expect(page.getByRole('heading', { name: 'New credit card' })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
});
