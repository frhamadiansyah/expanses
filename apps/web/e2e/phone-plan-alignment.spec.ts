import { expect, test } from '@playwright/test';
import { chooseCategory, showPlanCard, TODAY } from './event-plan';

/** The plan page's category card reads as one column: its mark and an item's checklist circle share a size and a left edge, and the names share a left edge. */
test('by thumb: an item’s circle lines up with its category’s mark, and its name with the category’s name', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Coast week');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Coast week', exact: true })).toBeVisible();
  await showPlanCard(page);
  await page.getByTestId('open-plan').click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await page.getByLabel('What', { exact: true }).fill('Tickets');
  await page.getByLabel('Price each').fill('100000');
  await chooseCategory(page, 'Food and beverage');
  await page.getByRole('button', { name: 'Save' }).click();

  const card = page.getByTestId('plan-category').first();
  const mark = (await card.locator('> div').first().locator('> *').first().boundingBox())!;
  const circle = (await card.getByTestId('plan-item').first().locator('button span').first().boundingBox())!;
  const headName = (await card.locator('h2').boundingBox())!;
  const itemName = (await card.getByTestId('plan-item').first().locator('a span span').first().boundingBox())!;
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/plan-b.png' });
  expect(mark.width).toBe(28);
  expect(circle.width).toBe(28);
  expect(Math.abs(circle.x - mark.x)).toBeLessThan(1);
  expect(Math.abs(itemName.x - headName.x)).toBeLessThan(1);
});
