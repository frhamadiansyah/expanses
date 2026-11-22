import { expect, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { walletCard } from './card-section';
import { pickView } from './wallet';

/*
 * A credit card switched off "For spending" (owner, 22 Nov 2026) is not one of Wallet's cards, but opened from Net
 * worth it reads as a Wallet card does: ✕ and ⚙ over the big face that turns over, Pay · Spend · Points · Statement and
 * Recent under it. ✕ goes back where it was opened from, and Wallet's stack, grid and Balance box stay without it.
 */
test('by thumb: a credit card switched off For spending opens raised, as a Wallet card does, and stays out of Wallet', async ({ page }) => {
  test.setTimeout(120_000);
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '2400000' });
  await openCard(page, { name: 'Spare Card', owed: '730000' });
  await openCard(page, { name: 'Daily Card' });

  // Switch the spare card off For spending from its own Settings.
  await page.goto('/wallet');
  await walletCard(page, /^Spare Card/).click();
  await expect(page).toHaveURL(/\/cards\/([^/]+)$/);
  const cardUrl = page.url();
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).first().click();
  const forSpending = page.getByRole('checkbox', { name: 'For spending' });
  await forSpending.click();
  await expect(forSpending).not.toBeChecked();

  // Opened from Net worth's Liabilities, it is the raised card: ✕ and ⚙ in the bar, no title or ‹ Wallet.
  await page.goto('/net-worth');
  await page.getByTestId('type-drawer-debts:credit_card').click();
  await page.getByRole('link', { name: /^Spare Card/ }).first().click();
  await expect(page).toHaveURL(cardUrl);
  const wall = page.getByRole('region', { name: 'Cards' });
  const raised = wall.locator('[data-place="raised"]');
  await expect(raised).toHaveCount(1);
  await expect(wall.getByTestId('wallet-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Spare Card', exact: true })).toBeFocused();
  const bar = page.locator('header').filter({ has: page.getByRole('heading', { name: 'Spare Card', exact: true }) });
  await expect(bar.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Wallet', exact: true })).toHaveCount(0);

  // The big face turns over to Outstanding, as a Wallet card's does; the actions and Recent are under it.
  await raised.getByRole('button', { name: /^Spare Card.*, show balance$/ }).click();
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Outstanding');
  const actions = page.getByRole('group', { name: 'Actions' });
  await expect(actions.getByRole('button')).toHaveText(['Pay']);
  await expect(actions.getByRole('link')).toHaveText(['Spend', 'Points', 'Statement']);
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

  // ✕ goes back to Net worth, where it was opened from.
  await bar.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth$/);

  // Wallet still holds only the card kept for spending, in the pile and in the grid, and its Balance box leaves the spare card's debt out.
  await page.goto('/wallet');
  await expect(walletCard(page, /^Daily Card/)).toBeVisible();
  await expect(walletCard(page, /^Spare Card/)).toHaveCount(0);
  await pickView(page, 'Grid');
  await expect(page.getByTestId('wallet-cards-row')).toBeVisible();
  await expect(page.getByTestId('wallet-cards-row')).not.toContainText('730');
  await expect(page.getByTestId('wallet-balance')).toContainText('2.400.000');
  await expect(page.getByRole('link', { name: /^Spare Card/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Daily Card/ }).first()).toBeVisible();

  // Opened with nothing behind it (a reload), it is raised all the same, and ✕ lands on Wallet without it.
  await page.goto(cardUrl);
  await expect(raised.getByRole('button', { name: /^Spare Card.*, show (balance|card)$/ })).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole('link', { name: /^Spare Card/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Daily Card/ }).first()).toBeVisible();

  expect(crashes).toEqual([]);
});
