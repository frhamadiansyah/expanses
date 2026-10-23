import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage } from './card-section';

/** A credit card with a billing date, a points program and a rule, so its band has a figure to carry. */
async function addEarningCard(page: Page, name: string) {
  await openCard(page, { name });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  // The suggested base rule, so the card is set up and opens on Wallet's summary from now on.
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
}

/**
 * A desktop draws the same Wallet stack as a phone, at Wallet's own card width on a Mac rather than across the
 * column, with the front card's facts beside it — and opens a card the same way, keeping every action of its page.
 */
test('a desktop stacks cards of one fixed width and raises the one tapped, with its page beside and below', async ({ page }) => {
  for (const name of ['Alpha Card', 'Beta Card']) await addEarningCard(page, name);

  await page.goto('/wallet');
  const wall = page.getByRole('region', { name: 'Cards' });
  const cards = wall.getByTestId('wallet-card');
  await expect(cards).toHaveCount(2);
  const [back, front] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
  expect(Math.round(back.width)).toBe(380);
  expect(Math.round(front.width)).toBe(380);
  // Overlapping, back to front: the front card lies over the lower part of the one behind it.
  expect(front.y).toBeLessThan(back.y + back.height);
  expect(front.y).toBeGreaterThan(back.y);
  // A covered card's band carries what it owes; its points are on the line beside the stack.
  await expect(cards.nth(0).getByTestId('card-band')).toContainText(/Alpha Card.*Rp\s*0/);
  // The facts sit to the right of the stack.
  const facts = (await wall.getByTestId('wallet-facts').boundingBox())!;
  expect(facts.x).toBeGreaterThanOrEqual(front.x + front.width);

  // Tapping the covered card opens THAT card, raised at the same width, with its page's actions.
  await wall.getByRole('link', { name: /^Alpha Card, / }).click();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Alpha Card', exact: true })).toBeFocused();
  const raised = wall.locator('[data-place="raised"]');
  expect(Math.round((await raised.boundingBox())!.width)).toBe(380);
  // Wallet's summary, beside the card on a desktop: the tiles sit to its right.
  const unpaid = (await page.getByTestId('tile-left-to-pay').boundingBox())!;
  expect(unpaid.x).toBeGreaterThanOrEqual((await raised.boundingBox())!.x + 380);
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Points', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();

  // ⚙ opens the card's settings, a page of its own with its desktop forms; ‹ comes back to the raised card.
  await cardPage(page, 'Settings');
  await expect(page.getByRole('radiogroup', { name: 'Card sections' })).toHaveCount(0);
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await page.getByRole('button', { name: 'Alpha Card' }).click();
  await expect(page.getByTestId('tile-points')).toBeVisible();

  // Back behaves like ✕: the stack again, in its order.
  await page.goBack();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(wall.getByRole('link')).toHaveCount(2);
  await expect(cards.nth(1)).toHaveAttribute('data-front', '');
  await expect(cards.nth(1).getByRole('link')).toHaveAccessibleName(/^Beta Card, /);
});
