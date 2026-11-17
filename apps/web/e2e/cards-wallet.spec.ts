import { expect, type Page, test } from '@playwright/test';
import { openCard, openFace } from './accounts';
import { cardPage, saveCardTerms, setUpRewardsByHand, showCardBack } from './card-section';

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
 * Wallet's order; a double-click opens the card the phone's way, raised at Wallet's own desktop card width with every
 * action of its page under it.
 */
test('a wide screen draws the cards as faces side by side, and a double-click raises the one chosen at a fixed width, with its page below', async ({ page }) => {
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

  // A double-click opens THAT card, raised at Wallet's desktop card width, with its page's actions.
  await openFace(wall.getByRole('link', { name: /^Alpha Card, / }));
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Alpha Card', exact: true })).toBeFocused();
  const raised = wall.locator('[data-place="raised"]');
  // It grows from the face it was into Wallet's desktop card width.
  await expect.poll(async () => Math.round((await raised.boundingBox())!.width)).toBe(380);
  // Turned over, the card's back is the card's own box: Outstanding and the points on it.
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Outstanding');
  await expect.poll(async () => Math.round((await page.getByTestId('tile-left-to-pay').boundingBox())!.width)).toBe(380);
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Points', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();

  // ⚙ opens the card's settings, a page of its own with its desktop forms; ‹ comes back to the raised card.
  await cardPage(page, 'Settings');
  await expect(page.getByRole('radiogroup', { name: 'Card sections' })).toHaveCount(0);
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await page.getByRole('button', { name: 'Alpha Card', exact: true }).click();
  await expect(page.getByTestId('wallet-slot')).toBeVisible();

  // Back behaves like ✕: Mac Wallet again, in its order.
  await page.goBack();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(wall.getByRole('link')).toHaveCount(2);
  await expect(cards.nth(1).getByRole('link')).toHaveAccessibleName(/^Beta Card, /);
});
