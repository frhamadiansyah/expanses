import { expect, type Page, test } from '@playwright/test';
import { addBank, restorableCopies } from './recovery-fixture';

/*
 * The copy taken as the app goes to the background (`background-copy.ts`). A browser tab cannot be sent to the
 * background from a test, so the page is told it has been: `visibilityState` reads hidden and the event fires,
 * which is what WebKit does for a WKWebView whose app is put away, and what Capacitor's web shell turns into its
 * own `pause`. Both reach the same leave, so this is also the one-leave-one-attempt path.
 */

async function leave(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function comeBack(page: Page) {
  await page.evaluate(() => {
    // The overrides were own properties of `document`; without them the prototype's real getters answer again.
    delete (document as { visibilityState?: unknown }).visibilityState;
    delete (document as { hidden?: unknown }).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const backgroundCopies = async (page: Page) => (await restorableCopies(page)).filter((name) => name.endsWith('-background.sqlite3'));

/** Moves the page's clock on, so the ten minutes between background copies are not what stops the next one. */
async function later(page: Page, minutes: number) {
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + minutes * 60_000);
}

test('leaving the app after a change keeps a copy, and leaving again with nothing new keeps no other', async ({ page }) => {
  await addBank(page, 'Entered before leaving', '250000');

  await leave(page);
  await expect.poll(() => backgroundCopies(page), { timeout: 20_000 }).toHaveLength(1);
  const [first] = await backgroundCopies(page);
  await comeBack(page);

  // Past the ten minutes, so only "nothing changed" can be what holds the next one back.
  await later(page, 11);
  await leave(page);
  // Nothing to wait on when nothing is taken, so the page is given the time a copy would have needed.
  await page.waitForTimeout(1500);
  expect(await backgroundCopies(page)).toEqual([first]);
  await comeBack(page);

  // And it is on the Backup page, under its own words, beside the day's copy rather than instead of it.
  await page.goto('/backup');
  await expect(page.getByText(/Taken on leaving the app/).first()).toBeVisible();
  await expect(page.getByText(/The day’s copy/).first()).toBeVisible();
});

test('a later change replaces the background copy rather than adding one', async ({ page }) => {
  await addBank(page, 'First entry', '100000');
  await leave(page);
  await expect.poll(() => backgroundCopies(page), { timeout: 20_000 }).toHaveLength(1);
  const [first] = await backgroundCopies(page);
  await comeBack(page);

  await addBank(page, 'Second entry', '200000');
  await later(page, 11);
  await leave(page);
  await expect.poll(async () => (await backgroundCopies(page)).some((name) => name !== first), { timeout: 20_000 }).toBe(true);
  // Pruned after it verified, so the old one goes a moment after the new one lands.
  await expect.poll(() => backgroundCopies(page), { timeout: 10_000 }).toHaveLength(1);
});
