import { expect, type Page } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { addForm } from './add-transaction';
import { openAssets } from './drawers';

/**
 * Wallet's two promises, walked once and run at both widths (`wallet.spec.ts`, `phone-wallet.spec.ts`).
 *
 * "For spending" off keeps an account as savings: it leaves Wallet, its Balance and every Paid with, and stays on Net
 * worth's Assets and in a transfer's To. The eye hides the Balance box, the stack moves up into its place, and the
 * choice is still there after a reload.
 */

/** Opens the add form wherever this width keeps it: the Transactions page's button, or the phone's tab bar. */
async function openAdd(page: Page) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  return addForm(page);
}

export async function forSpendingOff(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '3000000' });
  await openAccount(page, { subtype: 'savings', name: 'Rainy day', balance: '5000000' });

  // Both are cards to begin with, and the Balance counts both.
  await page.goto('/wallet');
  await expect(walletCard(page, 'Everyday')).toBeVisible();
  await expect(page.getByTestId('wallet-balance')).toContainText('8.000.000');

  // Opened from its card, the account's ⚙ is in Wallet's bar; the switch is in its Settings.
  await walletCard(page, 'Rainy day').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByTestId('balance-card')).toContainText('5.000.000');
  await page.locator('header').getByRole('link', { name: 'Settings', exact: true }).click();
  const forSpending = page.getByLabel('For spending');
  await expect(forSpending).toBeChecked();
  await expect(page.getByText('Off: kept as savings.')).toBeVisible();
  await forSpending.click();
  await expect(forSpending).not.toBeChecked();

  // Gone from Wallet and from its Balance: only Everyday is spending money now.
  await page.goto('/wallet');
  await expect(walletCard(page, 'Everyday')).toBeVisible();
  await expect(walletCard(page, 'Rainy day')).toHaveCount(0);
  await expect(page.getByTestId('wallet-balance')).toContainText('3.000.000');
  await expect(page.getByTestId('wallet-balance')).not.toContainText('8.000.000');

  // Still on Net worth's Assets, where it opens its own page as before.
  await openAssets(page);
  await expect(page.getByRole('link', { name: /^Rainy day/ }).first()).toBeVisible();

  // Not offered under Paid with…
  const form = await openAdd(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  const paidWith = page.getByRole('dialog', { name: 'Paid with' });
  await expect(paidWith.getByRole('button', { name: 'Everyday', exact: true })).toBeVisible();
  await expect(paidWith.getByRole('button', { name: 'Rainy day', exact: true })).toHaveCount(0);
  await paidWith.getByRole('button', { name: 'Everyday', exact: true }).click();

  // …but a transfer still moves money into it.
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: /^To/ }).click();
  await expect(page.getByRole('dialog', { name: 'To', exact: true }).getByRole('button', { name: 'Rainy day', exact: true })).toBeVisible();
}

/**
 * The View menu lays the same cards out three ways, and the choice outlives a reload. A grid is two faces to a row,
 * each captioned with its name and its figure, and a face opens the card's page as the stack does. A carousel is one
 * card at a time with a dot per card and the shown card's Recent under it, which follow the card scrolled to the
 * middle. Stack puts the pile back.
 */
export async function walletViews(page: Page) {
  // A bank account and cash: the stack's order puts the bank first. Each opening balance is a transaction of its own.
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '3000000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '250000' });
  await page.goto('/wallet');
  const wall = page.getByRole('region', { name: 'Cards' });
  const faces = wall.getByTestId('wallet-card');
  const view = page.getByRole('button', { name: 'View', exact: true });
  const choose = async (name: string) => {
    await view.click();
    const menu = page.getByRole('menu', { name: 'View' });
    await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
    await menu.getByRole('menuitemradio', { name }).click();
    await expect(menu).toHaveCount(0);
  };
  const ticked = async (name: string) => {
    await view.click();
    await expect(page.getByRole('menu', { name: 'View' }).getByRole('menuitemradio', { name })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'View' })).toHaveCount(0);
  };

  // The stack to begin with, ticked as such.
  await expect(wall.getByTestId('wallet-facts')).toBeVisible();
  await ticked('Stack');

  // Grid: two whole faces side by side — one y, two x — each captioned with its name and its balance.
  await choose('Grid');
  await expect(page.getByTestId('wallet-grid')).toBeVisible();
  await expect(faces).toHaveCount(2);
  const [left, right] = [(await faces.nth(0).boundingBox())!, (await faces.nth(1).boundingBox())!];
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(Math.round(left.width)).toBe(Math.round(right.width));
  const captions = page.getByTestId('wallet-caption');
  await expect(captions.nth(0)).toContainText('Everyday');
  await expect(captions.nth(0)).toContainText('3.000.000');
  await expect(captions.nth(1)).toContainText('Pocket cash');
  await expect(captions.nth(1)).toContainText('250.000');
  // The face is the card's art, as in the stack.
  await expect(faces.nth(1).getByTestId('card-face')).toBeVisible();

  // A face opens the same page the stack opens, under the raised card; ✕ comes back to the grid.
  await walletCard(page, 'Everyday').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByTestId('balance-card')).toContainText('3.000.000');
  await expect(wall.locator('[data-place="raised"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByTestId('wallet-grid')).toBeVisible();

  // Remembered on this device.
  await page.reload();
  await expect(page.getByTestId('wallet-grid')).toBeVisible();
  await expect(faces).toHaveCount(2);
  await ticked('Grid');

  // Carousel: a dot per card, and the first card's Recent — its opening balance — under it.
  await choose('Carousel');
  await expect(page.getByTestId('wallet-carousel')).toBeVisible();
  await expect(page.getByTestId('wallet-grid')).toHaveCount(0);
  await expect(page.getByTestId('wallet-dot')).toHaveCount(2);
  await expect(page.getByTestId('wallet-dot').nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(wall.getByTestId('wallet-facts')).toContainText('Everyday');
  const recent = page.getByTestId('wallet-recent');
  await expect(recent.getByTestId('wallet-recent-row')).toHaveCount(1);
  await expect(recent).toContainText('3.000.000');
  // The next card peeks: it starts to the right of the shown one, inside the screen.
  const [shown, next] = [(await faces.nth(0).boundingBox())!, (await faces.nth(1).boundingBox())!];
  expect(next.x).toBeGreaterThan(shown.x + shown.width);
  expect(next.x).toBeLessThan(page.viewportSize()!.width);

  // Scrolled to the second card, the dots and the Recent follow it.
  await faces.nth(1).evaluate((node) => node.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await expect(page.getByTestId('wallet-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(wall.getByTestId('wallet-facts')).toContainText('Pocket cash');
  await expect(recent).toContainText('250.000');
  await expect(recent).not.toContainText('3.000.000');
  // See all opens the list filtered to that account.
  await expect(recent.getByRole('link', { name: 'See all' })).toHaveAttribute('href', /\/transactions\?account=/);
  // The centred card opens its page.
  await walletCard(page, 'Pocket cash').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByTestId('balance-card')).toContainText('250.000');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('wallet-carousel')).toBeVisible();

  // Stack: the pile is back, back to front, with the front card's facts under it.
  await choose('Stack');
  await expect(page.getByTestId('wallet-carousel')).toHaveCount(0);
  await expect(wall.locator('[data-place="slot"]')).toHaveCount(2);
  const [back, front] = [(await faces.nth(0).boundingBox())!, (await faces.nth(1).boundingBox())!];
  expect(Math.round(back.x)).toBe(Math.round(front.x));
  expect(front.y).toBeGreaterThan(back.y);
  expect(front.y).toBeLessThan(back.y + back.height);
  await expect(wall.getByTestId('wallet-facts')).toContainText('Pocket cash');
  await page.reload();
  await expect(wall.locator('[data-place="slot"]')).toHaveCount(2);
}

export async function eyeHidesBalance(page: Page) {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '250000' });
  await page.goto('/wallet');
  const box = page.getByTestId('wallet-balance');
  await expect(box).toBeVisible();
  const card = page.getByRole('region', { name: 'Cards' }).getByTestId('wallet-card').first();
  const shownAt = (await card.boundingBox())!.y;

  await page.getByRole('button', { name: 'Hide balance' }).click();
  await expect(box).toHaveCount(0);
  // The stack moves up into the box's place.
  await expect.poll(async () => (await card.boundingBox())!.y).toBeLessThan(shownAt);
  // Card figures are never masked.
  await expect(walletCard(page, 'Pocket cash')).toHaveAccessibleName(/250\.000/);

  // Remembered on this device.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show balance' })).toBeVisible();
  await expect(box).toHaveCount(0);

  await page.getByRole('button', { name: 'Show balance' }).click();
  await expect(box).toBeVisible();
  await page.reload();
  await expect(box).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide balance' })).toBeVisible();
}
