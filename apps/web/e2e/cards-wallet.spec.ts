import { expect, type Page, test } from '@playwright/test';

/** A credit card with a billing date, a points program and a rule, so its band has a figure to carry. */
async function addEarningCard(page: Page, name: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto('/cards');
  await page.getByRole('region', { name: 'Your cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
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

  await page.goto('/cards');
  const wall = page.getByRole('region', { name: 'Your cards' });
  const cards = wall.getByTestId('wallet-card');
  await expect(cards).toHaveCount(2);
  const [back, front] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
  expect(Math.round(back.width)).toBe(380);
  expect(Math.round(front.width)).toBe(380);
  // Overlapping, back to front: the front card lies over the lower part of the one behind it.
  expect(front.y).toBeLessThan(back.y + back.height);
  expect(front.y).toBeGreaterThan(back.y);
  await expect(cards.nth(0).getByTestId('card-band')).toContainText(/Alpha Card.*\d+ points/);
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
  await expect(page.getByTestId('tile-points').getByRole('button', { name: 'Use', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest transactions' })).toBeVisible();

  // ⋯ → Card details keeps every section of the old page, the segmented control and its desktop forms included.
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Card details' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Card sections' }).getByRole('radio')).toHaveCount(4);
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await page.getByRole('button', { name: 'Back to Alpha Card' }).click();
  await expect(page.getByTestId('tile-points')).toBeVisible();

  // Back behaves like ✕: the stack again, in its order.
  await page.goBack();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(wall.getByRole('link')).toHaveCount(2);
  await expect(cards.nth(1)).toHaveAttribute('data-front', '');
  await expect(cards.nth(1).getByRole('link')).toHaveAccessibleName(/^Beta Card, /);
});
