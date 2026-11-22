import { expect, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { walletCard } from './card-section';
import { openAssets } from './drawers';
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

/*
 * Money works the same way (owner, 22 Nov 2026): a saving account switched off "For spending" is savings, not a Wallet
 * card, but opened from Net worth's Assets it is raised under its card face as Wallet's money is — ✕ and ⚙, the face
 * that turns over to its balance, the round actions and Recent — and Wallet's stack and Balance box stay without it.
 */
test('by thumb: a saving account switched off For spending opens raised from Assets, as Wallet money does, and stays out of Wallet', async ({ page }) => {
  test.setTimeout(120_000);
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '2400000' });
  await openAccount(page, { subtype: 'savings', name: 'Nest Egg', balance: '6150000' });

  // Switch the saving account off For spending from its Settings.
  await page.goto('/wallet');
  await walletCard(page, /^Nest Egg/).click();
  await expect(page).toHaveURL(/\/accounts\/([^/]+)$/);
  const accountUrl = page.url();
  await page.locator('header').getByRole('link', { name: 'Settings', exact: true }).click();
  const forSpending = page.getByLabel('For spending');
  await forSpending.click();
  await expect(forSpending).not.toBeChecked();

  // Opened from Net worth's Assets, it is the raised card: ✕ and ⚙ in the bar, the page under its face.
  await openAssets(page);
  await page.getByRole('link', { name: /^Nest Egg/ }).first().click();
  await expect(page).toHaveURL(accountUrl);
  const wall = page.getByRole('region', { name: 'Cards' });
  const raised = wall.locator('[data-place="raised"]');
  await expect(raised).toHaveCount(1);
  await expect(wall.getByTestId('wallet-card')).toHaveCount(1);
  await expect(page.getByTestId('wallet-slot')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nest Egg', exact: true })).toBeFocused();
  const bar = page.locator('header').filter({ has: page.getByRole('heading', { name: 'Nest Egg', exact: true }) });
  await expect(bar.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);

  // Its face turns over to the balance, as Wallet money's does; the round actions and Recent are under it.
  await raised.getByRole('button', { name: /^Nest Egg.*, show balance$/ }).click();
  await expect(page.getByTestId('balance-card')).toContainText('6.150.000');
  await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

  // ✕ goes back to Assets, where it was opened from.
  await bar.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  // Wallet holds only the money kept for spending, and its Balance is that money alone.
  await page.goto('/wallet');
  await expect(walletCard(page, /^Everyday/)).toBeVisible();
  await expect(walletCard(page, /^Nest Egg/)).toHaveCount(0);
  await pickView(page, 'Grid');
  await expect(page.getByTestId('wallet-balance')).toContainText('2.400.000');
  await expect(page.getByTestId('wallet-spending-row')).not.toContainText('6.150.000');
  await expect(page.getByRole('link', { name: /^Nest Egg/ })).toHaveCount(0);

  expect(crashes).toEqual([]);
});
