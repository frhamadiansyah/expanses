import { expect, test } from '@playwright/test';
import { recordMonth } from './money-flow';

/*
 * The Money flow box on a phone: three columns in 326 px, so the names are short, a thin bar in the middle keeps
 * quiet, and nothing runs off the right edge. A thumb on a category opens its list; the › opens the chart sideways
 * on a screen of its own, where every category is named.
 */

// The box is set aside for now (2026-10-24): not mounted on Cashflow, and nothing leads to /transactions/flow.
test.skip(true, 'The Money flow box is set aside: not mounted on Cashflow, nothing leads to its screen.');

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('by thumb: the box fits the phone, a category opens its list, and the full screen turns the chart sideways', async ({ page }) => {
  await recordMonth(page);

  const box = page.getByTestId('money-flow');
  await box.scrollIntoViewIfNeeded();
  await expect(box).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(box.locator('[data-testid^="flow-source-"]')).toHaveCount(1);
  await expect(box.locator('[data-testid^="flow-account-"]')).toHaveCount(2);
  const targets = box.locator('[data-testid^="flow-target-"]');
  await expect(targets).toHaveCount(3);
  await expect(targets.nth(0)).toContainText('Household');
  await expect(targets.nth(1)).toContainText('Travel');
  await expect(targets.nth(2)).toContainText('Saved');
  // The bank, tall, is named in the middle; the card, a sliver at 150.000 of 12.000.000, is not.
  await expect(box.locator('[data-testid^="flow-account-"][aria-label^="BCA Tahapan"] text')).toHaveCount(1);
  await expect(box.locator('[data-testid^="flow-account-"][aria-label^="BCA Visa"] text')).toHaveCount(0);
  // The drawing stays inside the box.
  const drawn = (await box.getByTestId('flow-chart').boundingBox())!;
  const frame = (await box.boundingBox())!;
  expect(drawn.x).toBeGreaterThanOrEqual(frame.x);
  expect(drawn.x + drawn.width).toBeLessThanOrEqual(frame.x + frame.width + 1);

  await targets.nth(1).tap();
  await expect(page).toHaveURL(/\/transactions\?.*account=/);
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await expect(page.getByTestId('transaction-row')).toContainText('Grab to the office');

  // The full screen: the chart lies along the phone's long edge, every category named, and ‹ comes back.
  await page.goto('/transactions');
  await page.getByTestId('money-flow-open').tap();
  await expect(page).toHaveURL(/\/transactions\/flow/);
  const screen = page.getByTestId('money-flow-page');
  await expect(screen).toBeVisible();
  const chart = screen.getByTestId('flow-chart');
  const shown = (await chart.boundingBox())!;
  // Turned a quarter: on screen it is taller than it is wide, inside a frame that is too.
  expect(shown.height).toBeGreaterThan(shown.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(screen.locator('[data-testid^="flow-target-"]')).toHaveCount(3);
  await expect(screen.locator('[data-testid^="flow-account-"][aria-label^="BCA Visa"]')).toBeVisible();
  await page.getByRole('link', { name: 'Cashflow' }).tap();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
});
