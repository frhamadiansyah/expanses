import { expect, type Locator, type Page, test } from '@playwright/test';
import { restoreAgedByDays } from './backup-reminders-fixture';
import { addBank } from './recovery-fixture';

/*
 * The shell in the dark — what the audit found and the restyle did not cause: the kit resolved in the dark from
 * its first commit, and the frame around it never did. A black page kept a white tab bar, a sky-blue install
 * banner, and a white band at its foot, because the shell's colours were literals and the tokens could not reach
 * them.
 *
 * Every assertion here is the **token**, never a hex copied out of `tokens.css`: the test asks the browser what a
 * custom property resolved to and then asks for that same colour on the element. A hex in the test would pass
 * while the shell drew something else entirely, which is the failure this file exists to catch.
 */

test.use({ colorScheme: 'dark' });

/** The token as a computed colour: put it on a probe and read back what the browser made of it. */
async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${property})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

/** The colour an element is really painted in. */
const painted = (target: Locator) => target.evaluate((node) => getComputedStyle(node).backgroundColor);

/** What a screen's own text is drawn in. */
const inked = (target: Locator) => target.evaluate((node) => getComputedStyle(node).color);

/** The shell is on every phone screen, so this is the marker that the app has mounted. */
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('the page itself is the kit’s ground, so no white band shows under a dark screen', async ({ page }) => {
  await page.goto('/transactions');
  await expect(tabBar(page)).toBeVisible();

  // The dark block is the one that won...
  expect(await tokenColour(page, '--ph-ground')).toBe('rgb(0, 0, 0)');
  // ...and the page is drawn from it, rather than from a literal.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(await tokenColour(page, '--ph-ink'));
  // `color-scheme` is what lets the browser draw its own furniture — the scrollbar, a date picker — in the dark.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain('dark');
});

test('the floating tab bar is the kit’s chrome, not a white capsule on a black page', async ({ page }) => {
  await page.goto('/transactions');
  const bar = tabBar(page);
  await expect(bar).toBeVisible();

  expect(await tokenColour(page, '--ph-chrome')).toBe('rgba(28, 28, 30, 0.8)');
  expect(await painted(bar)).toBe(await tokenColour(page, '--ph-chrome'));
  expect(await painted(bar)).not.toBe('rgb(255, 255, 255)');
});

test('the install banner is a toned panel, not the light one', async ({ page }) => {
  await page.goto('/transactions');
  const banner = page.getByRole('status').filter({ hasText: 'Install Expanses' });
  await expect(banner).toBeVisible();

  expect(await painted(banner)).toBe(await tokenColour(page, '--ph-info-panel'));
  // The light banner was Tailwind's sky-50; it is what the audit found on a black page.
  expect(await painted(banner)).not.toBe('rgb(240, 249, 255)');
  expect(await inked(banner)).toBe(await tokenColour(page, '--ph-info-ink'));
});

test('the backup reminder, its button and its ink all move together', async ({ page }, testInfo) => {
  await addBank(page, 'Needs backing up', '1000000');
  await restoreAgedByDays(page, testInfo.outputPath('aged.sqlite3'), 31);
  await page.goto('/transactions');

  const banner = page.getByRole('status').filter({ hasText: 'No backup in 31 days.' });
  await expect(banner).toBeVisible();
  expect(await painted(banner)).toBe(await tokenColour(page, '--ph-warn-panel'));
  expect(await inked(banner)).toBe(await tokenColour(page, '--ph-warn-ink'));

  /*
   * The button inside it is the shared primitive, so this is the sweep as much as the banner: a `Button` used to
   * be Tailwind's `bg-slate-900 text-white`, which on a dark page is a white slab with dark text on it.
   */
  const download = banner.getByRole('button', { name: 'Download backup' });
  expect(await painted(download)).toBe(await tokenColour(page, '--ph-ink'));
  expect(await inked(download)).toBe(await tokenColour(page, '--ph-surface'));
});

test.describe('the same shell in the light', () => {
  test.use({ colorScheme: 'light' });

  test('is the palette the light block defines, still read from the tokens', async ({ page }) => {
    await page.goto('/transactions');
    const bar = tabBar(page);
    await expect(bar).toBeVisible();

    expect(await tokenColour(page, '--ph-ground')).toBe('rgb(242, 242, 247)');
    expect(await tokenColour(page, '--ph-chrome')).toBe('rgba(255, 255, 255, 0.8)');
    expect(await painted(bar)).toBe(await tokenColour(page, '--ph-chrome'));
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));
  });
});
