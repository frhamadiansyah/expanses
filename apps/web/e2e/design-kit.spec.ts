import { expect, test } from '@playwright/test';

/**
 * The specimen sheet, on a wide screen.
 *
 * The kit's claim is that desktop is never the poor relation: a table stays a table, and a group stops growing
 * rather than stretching across 1440 px. Both are asserted here rather than left to a screenshot.
 */

test('the design kit draws its title with two corners, the third action behind a …', async ({ page }) => {
  await page.goto('/design-kit');
  await expect(page.getByRole('heading', { name: 'Design kit', level: 1 })).toBeVisible();

  const header = page.locator('header').first();
  // Four actions were given; the corner holds two buttons, and the second of them is the menu.
  await expect(header.getByRole('button', { name: 'Search' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'More', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

  await header.getByRole('button', { name: 'More', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'More' });
  await expect(menu.getByRole('menuitem', { name: 'Add a transaction' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete this month' })).toBeVisible();
});

test('Escape closes the … menu through the app’s own stack, and nothing behind it', async ({ page }) => {
  await page.goto('/design-kit');
  const header = page.locator('header').first();
  await header.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'More' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'More' })).toHaveCount(0);
  // The page it was opened over is still the page.
  await expect(page.getByRole('heading', { name: 'Design kit', level: 1 })).toBeVisible();
});

test('a table stays a table on a wide screen, with every column it has', async ({ page }) => {
  await page.goto('/design-kit');
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveCount(6);
  await expect(table.getByRole('columnheader', { name: 'What it was' })).toBeVisible();
  // The row's other columns are on screen, not hidden behind a chevron as they are on a phone.
  await expect(table.getByRole('cell', { name: 'SPBU 34-12907 Pondok Indah' })).toBeVisible();
});

test('a group stops growing rather than stretching the full width of a 1440px window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/design-kit');
  const group = page.locator('section', { has: page.getByRole('heading', { name: 'Friday 18 September' }) }).first();
  const box = (await group.boundingBox())!;
  // The group's own ceiling, not the shell's: a row two lines tall running the width of a desktop window is a
  // phone layout in desktop clothes.
  expect(box.width).toBeLessThanOrEqual(672);
});

test('the segmented control keeps its four segments on one line and equally wide', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.getByRole('radiogroup', { name: 'Card sections' });
  const segments = group.getByRole('radio');
  await expect(segments).toHaveCount(4);
  // "Rewards rules" shortened so the fourth segment survived.
  await expect(group.getByRole('radio', { name: 'Rules' })).toBeVisible();
  await expect(group.getByRole('radio', { name: 'Rewards rules' })).toHaveCount(0);

  const boxes = await segments.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top };
    }),
  );
  const first = boxes[0]!;
  for (const box of boxes) {
    expect(Math.abs(box.width - first.width)).toBeLessThanOrEqual(1);
    // One line: a wrapped label would be twice this tall, and the same top for all four says none dropped.
    expect(box.height).toBeLessThanOrEqual(34);
    expect(Math.abs(box.top - first.top)).toBeLessThanOrEqual(1);
  }
});

test('arrow keys move between segments, so the control is one tab stop rather than four', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.getByRole('radiogroup', { name: 'Card sections' });
  await group.getByRole('radio', { name: 'Statement' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Points' })).toHaveAttribute('aria-checked', 'true');
  await expect(group.getByRole('radio', { name: 'Statement' })).toHaveAttribute('aria-checked', 'false');
});
