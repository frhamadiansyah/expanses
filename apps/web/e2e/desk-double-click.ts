import type { Locator, Page } from '@playwright/test';

/*
 * A double-click on a wide screen's row (Mac Cashflow, Points, Bills, Wallet, Net worth, Review): its first click opens
 * the side peek and the page makes room for it, which can move the row from under the pointer before the second click.
 */

/**
 * Double-clicks at one place, the middle of `target`, as the Mac does: two clicks at the same spot, the second `gap` ms
 * after the first (Playwright's own pace when 0). Says whether the first click's making room moved
 * the row away, so the second click landed on something else.
 */
export async function doubleClickInPlace(page: Page, target: Locator, { gap = 0 }: { gap?: number } = {}) {
  // In view, and where it settles: a page still loading (a chart drawn, a box filled) moves it on its own, and that is not
  // the peek's doing.
  await target.scrollIntoViewIfNeeded();
  let box = await target.boundingBox();
  for (let tries = 0; tries < 50; tries++) {
    await page.waitForTimeout(100);
    const now = await target.boundingBox();
    const still = box !== null && now !== null && Math.abs(now.x - box.x) < 0.5 && Math.abs(now.y - box.y) < 0.5 && Math.abs(now.width - box.width) < 0.5;
    box = now;
    if (still) break;
  }
  if (!box) throw new Error('nothing to double-click');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  if (gap > 0) await page.waitForTimeout(gap);
  const moved = await target.evaluate((element, [px, py]) => !element.contains(document.elementFromPoint(px, py)), [x, y] as const);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
  return { moved };
}
