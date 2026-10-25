import { expect, type Page, test } from '@playwright/test';
import { openAccount, openWalletAccount, showBalance, showCard } from './accounts';
import { mockRates, openWithPockets } from './pockets';

/**
 * The account page's hero is the card Wallet raised: tapped, it turns over to a white back with the balance on it, and
 * back. Face up is the default whenever the page opens; nothing is remembered.
 */

const turn = (page: Page) => page.getByTestId('card-turn');
const raised = (page: Page) => page.getByRole('region', { name: 'Cards' }).locator('[data-place="raised"]');

test('the card is the hero; a tap turns it to the balance and a second tap back', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', shown: 'Bank One Everyday', balance: '12500000', extra: (p) => p.getByLabel('Bank', { exact: true }).pressSequentially('Bank One') });
  await openWalletAccount(page, 'Bank One Everyday');

  // Face up to begin with, and the balance drawn once: no white box on the page, nothing of the back showing.
  await expect(raised(page).getByTestId('card-face')).toBeVisible();
  await expect(page.getByTestId('balance-card')).toBeHidden();
  const toBalance = page.getByRole('button', { name: /, show balance$/ });
  await expect(toBalance).toHaveAttribute('aria-pressed', 'false');
  // The page below is the round actions, then Recent.
  await expect(page.getByRole('group', { name: 'Actions' })).toBeVisible();
  const front = (await raised(page).boundingBox())!;

  await toBalance.click();
  const back = page.getByTestId('balance-card');
  await expect(back).toBeVisible();
  await expect(back).toContainText('Balance');
  await expect(back).toContainText('12.500.000');
  await expect(back).toContainText('Bank One · Current account');
  await expect(back.getByTestId('card-currency')).toHaveAccessibleName('IDR · Indonesian Rupiah');
  await expect(back).toContainText('30 days ago');
  await expect(back).toContainText('today');
  await expect(turn(page)).toHaveAttribute('data-flipped', '');
  // The face is out of the page's reading while the back shows, and the toggle says so.
  await expect(raised(page).getByTestId('card-face')).toBeHidden();
  await expect(page.getByRole('button', { name: /, show card$/ })).toHaveAttribute('aria-pressed', 'true');
  // The back is the card's own box: the page below does not move.
  // (Measured once the turn has landed: mid-turn the card is edge-on.)
  await expect.poll(async () => { const now = (await back.boundingBox())!; return Math.max(Math.abs(now.width - front.width), Math.abs(now.height - front.height)); }).toBeLessThanOrEqual(1);
  const behind = (await back.boundingBox())!;
  expect(Math.abs(behind.height - front.height)).toBeLessThanOrEqual(1);
  expect(Math.abs((await raised(page).boundingBox())!.height - front.height)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: /, show card$/ }).click();
  await expect(back).toBeHidden();
  await expect(raised(page).getByTestId('card-face')).toBeVisible();
  await expect(turn(page)).not.toHaveAttribute('data-flipped');

  // Reachable from the keyboard.
  await page.getByRole('button', { name: /, show balance$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(back).toBeVisible();
  // The small button on the back is the one to turn it over.
  await page.getByRole('button', { name: /, show card$/ }).focus();
  await page.keyboard.press('Space');
  await expect(back).toBeHidden();
});

test('the card opens face up again each time: nothing is remembered', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '300000' });
  await openWalletAccount(page, 'Pocket cash');
  await showBalance(page);
  await expect(page.getByTestId('balance-card').getByTestId('card-figure')).toContainText('300.000');
  // ✕ puts the card back; opened again it is face up.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await openWalletAccount(page, 'Pocket cash');
  await expect(page.getByTestId('balance-card')).toBeHidden();
  await showBalance(page);
  await showCard(page);
});

test('an account with pockets keeps its balance line on the back: all pockets, and how many currencies', async ({ page }) => {
  await mockRates(page, { USD: 16_250 });
  await openWithPockets(page, { name: 'Valas Plus', bank: 'Bank One', shown: 'Bank One Valas Plus', pockets: [{ currency: 'USD', balance: '300.00', rate: '16250' }, { currency: 'IDR', balance: '5000000' }] });
  await openWalletAccount(page, 'Bank One Valas Plus');
  await expect(page.getByText('Balance, all pockets')).toBeHidden();
  await showBalance(page);
  const back = page.getByTestId('balance-card');
  await expect(back).toContainText('Balance, all pockets');
  await expect(back.getByTestId('card-figure')).toContainText('≈');
  await expect(back.getByTestId('card-figure')).toContainText('9.875.000');
  await expect(page.getByText('Bank One · Saving account · 2 currencies')).toBeVisible();
  // The pockets list is on the page itself, whichever side shows.
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('a reader who asks for less motion gets a cross-fade, and the same two sides', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openWalletAccount(page, 'Everyday');
  await page.getByRole('button', { name: /, show balance$/ }).click();
  await expect(page.getByTestId('balance-card')).toContainText('12.500.000');
  // No rotation is applied to the turning layer.
  expect(await turn(page).evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  await page.getByRole('button', { name: /, show card$/ }).click();
  await expect(page.getByTestId('balance-card')).toBeHidden();
  await expect(raised(page).getByTestId('card-face')).toBeVisible();
});
