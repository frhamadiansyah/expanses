import { expect, test } from '@playwright/test';
import { openAccount, walletCard } from './accounts';
import { balanceOnGridOnly, balanceRows, forSpendingOff, walletReorder, walletViews } from './wallet';

test('an account switched off For spending leaves Wallet and Paid with, and stays on Assets and in a transfer’s To', async ({ page }) => {
  await forSpendingOff(page);
});

test('the Balance box is always over the grid and nowhere else, with no eye', async ({ page }) => {
  await balanceOnGridOnly(page);
});

test('Spending money and Outstanding on cards filter the grid, and Bills still to pay comes off the Balance and opens its sheet', async ({ page }) => {
  await balanceRows(page);
});

test('View lays the cards out as a grid with captions or a carousel with the shown card’s Recent, remembers the choice, and Stack puts the pile back', async ({ page }) => {
  await walletViews(page);
});

test('Reorder cards puts a credit card in front of the money in all three views, keeps it over a reload, and ‹ keeps nothing', async ({ page }) => {
  await walletReorder(page);
});

/*
 * A bank account's debit card rewards are reached from the account's Settings, not from a group on Wallet: the row says
 * "Not set up" until the account has a programme, and opens a sheet to pick the card from the catalogue, or to set it up by hand on its page.
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
  // A sheet, not a page: a searchable list of the debit cards, with Add manually as its last row.
  await row.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Search' }).click();
  await sheet.getByPlaceholder('Search').fill('blu');
  await expect(sheet.getByRole('button', { name: 'Add manually' })).toBeVisible();
  // One tap links the account to the card's programme and closes the sheet; the row then names it.
  await sheet.getByRole('button', { name: 'Garuda x Blu Debit' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText('GarudaMiles');
  // Linked: the sheet marks the current card and offers the card page, where the rules are kept.
  await row.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Garuda x Blu Debit' })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Open card page' }).click();
  await expect(page).toHaveURL(new RegExp(`/cards/${accountId}$`));
  // A card that is not listed is set up by hand, on the same page.
  await page.goBack();
  await row.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add manually' }).click();
  await expect(page).toHaveURL(new RegExp(`/cards/${accountId}$`));
});
