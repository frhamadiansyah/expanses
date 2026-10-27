import { expect, type Page } from '@playwright/test';

/**
 * A card on the wallet, by name. The Cards page also lists the points programmes, and a programme's row carries the
 * name of the card earning into it, so a card is looked for on the wallet itself.
 */
export const walletCard = (page: Page, name: string | RegExp) => page.getByRole('region', { name: 'Cards' }).getByRole('link', { name });

/**
 * Open one of the card's own pages from its summary. The four tabs it had are pages now: the statement (the round
 * Statement button), this statement's points (its row on the summary), and the settings (⚙ in the corner), which hold
 * what the Card and Rewards rules tabs did.
 */
export async function cardPage(page: Page, which: 'Statement' | 'Points' | 'Settings') {
  const main = page.getByRole('main');
  if (which === 'Statement') await main.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Statement', exact: true }).click();
  else if (which === 'Points') await main.getByTestId('this-statement-points').click();
  else await main.getByRole('link', { name: 'Settings', exact: true }).first().click();
  const title = { Statement: 'Statement', Points: "This statement's points", Settings: 'Settings' }[which];
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
}

/** Open a page under the card's Settings — Card product, Earning rules, Spend bonuses — from the Settings page. */
export async function cardSettingsPage(page: Page, which: 'Card product' | 'Earning rules' | 'Spend bonuses') {
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${which}`) }).click();
  await expect(page.getByRole('heading', { name: which, exact: true }).first()).toBeVisible();
}

/** The card's purchases with what each earned: this statement's points, then Purchases. */
export async function cardPurchases(page: Page) {
  await cardPage(page, 'Points');
  await cardPointsPage(page, 'Purchases');
}

/**
 * Save the card's terms from its Settings page: Enter in a terms field (Due date unless given) is the form's own
 * save, and the page stays. A card being set up then moves to its next step, so the first step's label is waited
 * to go; the short wait lets the write settle before the spec moves on.
 */
export async function saveCardTerms(page: Page, field = 'Due date') {
  await page.getByLabel(field, { exact: true }).press('Enter');
  await expect(page.getByText('Step 1 of 3')).toHaveCount(0);
  await page.waitForTimeout(300);
}

/** Open a page under this statement's points — the purchases, or the points the statement shows. */
export async function cardPointsPage(page: Page, which: 'Purchases' | 'Points the statement shows') {
  await page.getByRole('main').getByRole('link', { name: new RegExp(`^${which}`) }).click();
  await expect(page.getByRole('heading', { name: which === 'Purchases' ? 'Purchases' : 'Points on the statement', exact: true }).first()).toBeVisible();
}
