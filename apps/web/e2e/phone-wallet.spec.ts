import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { balanceOnGridOnly, balanceRows, forSpendingOff, walletReorder, walletViews } from './wallet';

/** The same Wallet journeys as `wallet.spec.ts`, at a phone's width with its tab bar. */
test('an account switched off For spending leaves Wallet and Paid with, and stays on Assets and in a transfer’s To', async ({ page }) => {
  await forSpendingOff(page);
});

test('the Balance box is always over the grid and nowhere else, with no eye', async ({ page }) => {
  await balanceOnGridOnly(page);
});

test('Spending money and Owed on cards filter the grid, and Bills still to pay comes off the Balance and opens its sheet', async ({ page }) => {
  await balanceRows(page);
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

test('Wallet’s + opens New account, and its Type row reaches the credit card form with no debt to choose first', async ({ page }) => {
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts\/add$/);
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Credit card' });
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add card' })).toBeVisible();
});

test('Wallet’s + opens a money account form straight away as a current account, and its Type row changes the kind', async ({ page }) => {
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts\/add$/);
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();
  const type = page.getByLabel('Type', { exact: true });
  await expect(type).toHaveValue('bank');
  await type.selectOption({ label: 'Cash' });
  await page.getByLabel('Name', { exact: true }).pressSequentially('Pocket money');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByText('Pocket money').first()).toBeVisible();
});
