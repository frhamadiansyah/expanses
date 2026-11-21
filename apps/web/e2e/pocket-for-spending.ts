import { expect, type Page } from '@playwright/test';
import { expectWalletFigure, openSettings, walletCard } from './accounts';
import { addForm } from './add-transaction';
import { openAssets } from './drawers';
import { mockRates, openWithPockets } from './pockets';
import { pickView } from './wallet';

/**
 * "For spending" on one pocket, walked once and run at both widths (`pocket-for-spending.spec.ts`,
 * `phone-pocket-for-spending.spec.ts`).
 *
 * Cash holding rupiah and the lira left after a trip: the lira pocket is switched off in its own Settings, so it
 * leaves Paid with, the cash card's figure and Wallet's Balance, while Assets still counts the account whole. The
 * account switched off keeps every pocket out and the pocket's switch cannot be changed; on again, the lira is still
 * off. Every figure is invented.
 */
const CASH = {
  name: 'Travel cash',
  kind: 'Cash banknotes and coins',
  pockets: [
    { currency: 'IDR', balance: '2000000' },
    { currency: 'TRY', balance: '1000.00', rate: '480' },
  ],
};

/** The add form's Paid with sheet, opened and left open for the caller to read. */
async function paidWithSheet(page: Page) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  await addForm(page).getByRole('button', { name: /^Payment method/ }).click();
  return page.getByRole('dialog', { name: 'Payment method' });
}

/** The grid's Balance box (the pile shows none). */
async function walletBalance(page: Page) {
  await page.goto('/wallet');
  await pickView(page, 'Grid');
  return page.getByTestId('wallet-balance');
}

/** A pocket's Settings, reached as a person does: its account's card, the pocket's row, then ⋯ → Settings. */
async function openPocketSettings(page: Page, currency: string) {
  await page.goto('/wallet');
  await walletCard(page, CASH.name).click();
  await page.getByTestId(`pocket-${currency}`).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await openSettings(page);
  return page.getByLabel('For spending');
}

/** The account's own Settings, from its card on Wallet. */
async function openAccountSettings(page: Page) {
  await page.goto('/wallet');
  await walletCard(page, CASH.name).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await page.locator('header').getByRole('link', { name: 'Settings', exact: true }).click();
  return page.getByLabel('For spending');
}

export async function pocketForSpending(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await mockRates(page, { TRY: 480 });
  await openWithPockets(page, CASH);

  // Both pockets are spending money to begin with: 2.000.000 + 1.000 × 480.
  await expectWalletFigure(page, CASH.name, '2.480.000');
  await expect(await walletBalance(page)).toContainText('2.480.000');

  // The lira pocket's own switch, on by default, with words about the pocket.
  const lira = await openPocketSettings(page, 'TRY');
  await expect(lira).toBeChecked();
  await expect(lira).toBeEnabled();
  await lira.click();
  await expect(lira).not.toBeChecked();

  // Not offered under Paid with; the rupiah pocket still is.
  let sheet = await paidWithSheet(page);
  await expect(sheet.getByRole('button', { name: `${CASH.name} · IDR`, exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: `${CASH.name} · TRY`, exact: true })).toHaveCount(0);

  // Wallet's Balance and the cash card drop by the lira's rupiah value; the card is still there.
  await expect(await walletBalance(page)).toContainText('2.000.000');
  await expect(page.getByTestId('wallet-balance')).not.toContainText('2.480.000');
  await expectWalletFigure(page, CASH.name, '2.000.000');

  // Assets still counts the account whole.
  await openAssets(page);
  await expect(page.getByRole('link', { name: new RegExp(`^${CASH.name}`) }).first()).toContainText('2.480.000');

  // The account switched off keeps every pocket out: the lira's switch is shown off and cannot be changed.
  const account = await openAccountSettings(page);
  await expect(account).toBeChecked();
  await account.click();
  await expect(account).not.toBeChecked();
  await page.goto('/wallet');
  await expect(walletCard(page, 'Travel cash')).toHaveCount(0);
  await openAssets(page);
  await page.getByRole('link', { name: new RegExp(`^${CASH.name}`) }).first().click();
  await page.getByTestId('pocket-IDR').click();
  await openSettings(page);
  const rupiah = page.getByLabel('For spending');
  await expect(rupiah).not.toBeChecked();
  await expect(rupiah).toBeDisabled();

  // On again: the rupiah is back, and the lira is still kept as savings.
  await openAssets(page);
  await page.getByRole('link', { name: new RegExp(`^${CASH.name}`) }).first().click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await openSettings(page);
  await page.getByLabel('For spending').click();
  await expect(page.getByLabel('For spending')).toBeChecked();
  await expectWalletFigureOn(page, '2.000.000');

  // The lira switched back on: it returns to Paid with and to the Balance.
  const again = await openPocketSettings(page, 'TRY');
  await expect(again).not.toBeChecked();
  await again.click();
  await expect(again).toBeChecked();
  sheet = await paidWithSheet(page);
  // Two currencies offered again: the account is one row, its pockets folded under it (account tree, 12 Nov).
  await sheet.getByRole('button', { name: CASH.name, exact: true, expanded: false }).click();
  await expect(sheet.getByRole('button', { name: `${CASH.name} · TRY`, exact: true })).toBeVisible();
  await expect(await walletBalance(page)).toContainText('2.480.000');
  await expectWalletFigure(page, CASH.name, '2.480.000');
}

async function expectWalletFigureOn(page: Page, figure: string) {
  await page.goto('/wallet');
  await expectWalletFigure(page, CASH.name, figure);
}

/**
 * Every pocket switched off one by one: the account has nothing left to spend, so it leaves Wallet and its own switch
 * reads off. Switched on, both pockets are spent from again.
 */
export async function everyPocketOff(page: Page) {
  page.on('dialog', (dialog) => void dialog.accept());
  await mockRates(page, { TRY: 480 });
  await openWithPockets(page, CASH);

  for (const currency of ['TRY', 'IDR']) {
    const pocket = await openPocketSettings(page, currency);
    await expect(pocket).toBeChecked();
    await pocket.click();
    await expect(pocket).not.toBeChecked();
  }
  await page.goto('/wallet');
  await expect(walletCard(page, CASH.name)).toHaveCount(0);

  // The account's own Settings, reached from Assets now that it has no card: off, and it can be switched.
  await openAssets(page);
  await page.getByRole('link', { name: new RegExp(`^${CASH.name}`) }).first().click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await openSettings(page);
  const account = page.getByLabel('For spending');
  await expect(account).not.toBeChecked();
  await expect(account).toBeEnabled();
  await account.click();
  await expect(account).toBeChecked();

  // Both pockets are on again: in Paid with, on their own switches, and the card counts both.
  const sheet = await paidWithSheet(page);
  await sheet.getByRole('button', { name: CASH.name, exact: true, expanded: false }).click();
  await expect(sheet.getByRole('button', { name: `${CASH.name} · IDR`, exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: `${CASH.name} · TRY`, exact: true })).toBeVisible();
  for (const currency of ['TRY', 'IDR']) await expect(await openPocketSettings(page, currency)).toBeChecked();
  await expectWalletFigureOn(page, '2.480.000');
}
