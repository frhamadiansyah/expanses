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
