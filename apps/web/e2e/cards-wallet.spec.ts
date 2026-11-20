import { expect, type Page, test } from '@playwright/test';
import { openCard, openFace } from './accounts';
import { cardPage, saveCardTerms, setUpRewardsByHand } from './card-section';

/** A credit card with a billing date, a points program and a rule, so its band has a figure to carry. */
async function addEarningCard(page: Page, name: string) {
  await openCard(page, { name });
  await page.goto('/wallet');
  await openFace(page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }));
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await setUpRewardsByHand(page);
  // The suggested base rule, so the card is set up and opens on Wallet's summary from now on.
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
}

/**
 * A wide screen draws each card as its own face (Mac Wallet), the credit cards side by side under Credit cards in
 * Wallet's order; a double-click opens the card's own Mac page, full width (Mac account pages, owner 2026-11-20): its
 * face in the Outstanding box, its points, and its statement under them.
 */
test('a wide screen draws the cards as faces side by side, and a double-click opens the one chosen as its own full-width page', async ({ page }) => {
  for (const name of ['Alpha Card', 'Beta Card']) await addEarningCard(page, name);

  await page.goto('/wallet');
  const wall = page.getByRole('region', { name: 'Cards' });
  const cards = wall.getByTestId('wallet-card');
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('wallet-group-credit').getByTestId('wallet-card')).toHaveCount(2);
  const [first, second] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
  // One row, in Wallet's order, two whole faces of one width.
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
  expect(second.x).toBeGreaterThan(first.x + first.width);
  expect(Math.round(first.width)).toBe(Math.round(second.width));
  await expect(cards.nth(0).getByTestId('card-face')).toContainText('Alpha Card');
  await expect(cards.nth(0).getByTestId('face-figure')).toBeVisible();

  // A double-click opens THAT card's own page: its face, what it owes, its points and its statement.
  await openFace(wall.getByRole('link', { name: /^Alpha Card, / }));
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Alpha Card', exact: true })).toBeVisible();
  const desk = page.getByTestId('card-desk');
  await expect(desk.getByTestId('desk-face')).toBeVisible();
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Outstanding');
  await expect(page.getByTestId('tile-points')).toBeVisible();
  await expect(page.getByTestId('desk-points-link')).toBeVisible();
  await expect(page.getByTestId('card-table')).toContainText('This statement');

  // ⚙ opens the card's settings, a page of its own with its desktop forms; ‹ comes back to the card's page.
  await cardPage(page, 'Settings');
  await expect(page.getByRole('radiogroup', { name: 'Card sections' })).toHaveCount(0);
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await page.getByRole('button', { name: 'Alpha Card', exact: true }).click();
  await expect(desk).toBeVisible();

  // Back: Mac Wallet again, in its order.
  await page.goBack();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(wall.getByRole('link')).toHaveCount(2);
  await expect(cards.nth(1).getByRole('link')).toHaveAccessibleName(/^Beta Card, /);
});
