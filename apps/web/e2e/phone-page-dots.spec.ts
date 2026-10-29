import { expect, type Locator, test } from '@playwright/test';
import { addPlastic, openCard } from './accounts';
import { cardPage } from './card-section';
import { showMonthly } from './bill-form';
import { addFarYearlyBill, addMonthlyBill } from './recurring-slider';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

/** The inner dots' size and the distance between the first two centres. */
async function measure(group: Locator) {
  const boxes = await group.getByTestId('page-dot').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  return { width: boxes[0].width, height: boxes[0].height, pitch: boxes[1].x + boxes[1].width / 2 - (boxes[0].x + boxes[0].width / 2) };
}

test('page dots look the same on the Recurring hero and on a card with two plastics, and tap targets are 44 tall', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  const recurring = page.getByRole('group', { name: 'Page' });
  const hero = await measure(recurring);
  await page.screenshot({ path: `${SHOTS}/dots-recurring.png` });
  const target = await recurring.getByRole('button').first().boundingBox();
  expect(target!.height).toBeGreaterThanOrEqual(44);

  await openCard(page, { name: 'Dots Card' });
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Dots Card(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await addPlastic(page, '1111', 'Me');
  await addPlastic(page, '2222', 'Spouse');
  await page.goto('/wallet');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Dots Card(,|$)/ }).click();
  const cards = page.getByRole('group', { name: 'Cards on this account' });
  await expect(cards.getByTestId('page-dot')).toHaveCount(2);
  const card = await measure(cards);
  await page.screenshot({ path: `${SHOTS}/dots-card.png` });

  expect(card.width).toBe(7);
  expect(card.height).toBe(7);
  expect(card).toEqual(hero);
  expect(hero.pitch).toBeCloseTo(14, 0);

  // The page in view is the only one marked, and the card's dots say pressed where the hero's say current.
  await expect(cards.getByRole('button', { name: /ending 1111/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.getByRole('button', { name: /ending 2222/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(cards.locator('[aria-current]')).toHaveCount(0);
});

test('the Recurring dots mark the page with aria-current and move it on a tap', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await showMonthly(page);
  const dots = page.getByRole('group', { name: 'Page' });
  await expect(dots.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-current', 'true');
  await expect(dots.getByRole('button', { name: 'Repeating' })).not.toHaveAttribute('aria-current', 'true');
  await expect(dots.locator('[aria-pressed]')).toHaveCount(0);
  await dots.getByRole('button', { name: 'Repeating' }).click();
  await expect(dots.getByRole('button', { name: 'Repeating' })).toHaveAttribute('aria-current', 'true');
  await expect(dots.getByRole('button', { name: 'Monthly' })).not.toHaveAttribute('aria-current', 'true');
});
