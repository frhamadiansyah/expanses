import { expect, test } from '@playwright/test';
import { addBank, corruptTheDatabase, CORRUPT_HEADLINE, EXPORT_BUTTON } from './recovery-fixture';

/** Anything a frightened thumb is meant to hit must be at least this tall. */
const TAP = 44;

test('a corrupt database reaches a recovery screen a thumb can work on a phone', async ({ page }) => {
  await addBank(page, 'Rescue me', '1000000');
  await corruptTheDatabase(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: CORRUPT_HEADLINE, exact: true })).toBeVisible();

  const exportButton = page.getByRole('button', { name: EXPORT_BUTTON, exact: true });
  const retry = page.getByRole('button', { name: 'Try again', exact: true });
  const boxes = [];
  for (const button of [exportButton, retry]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
    // A recovery screen on a phone is the last place to make someone aim.
    expect(box!.height, `"${await button.textContent()}" is ${box!.height}px tall`).toBeGreaterThanOrEqual(TAP);
  }
  // Stacked, not side by side: the same left edge and width, each one below the last.
  expect(boxes[1]!.x).toBeCloseTo(boxes[0]!.x, 0);
  expect(boxes[1]!.width).toBeCloseTo(boxes[0]!.width, 0);
  expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);

  // Nothing pushes the page sideways: a screen you have to scroll to read is a screen you do not read.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

  const download = page.waitForEvent('download');
  await exportButton.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^expanses-recovery-\d{4}-\d{2}-\d{2}\.sqlite3$/);
});
